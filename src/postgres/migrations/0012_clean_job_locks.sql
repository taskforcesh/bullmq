CREATE OR REPLACE FUNCTION clean(
  p_queue text, p_type text, p_ts bigint, p_limit integer
) RETURNS SETOF text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_where             text;
  v_scheduler_filter  text := 'AND scheduler_id IS NULL';
  v_ids               text[];
  v_pq                text[];
  v_pid               text[];
  i                   integer;
BEGIN
  IF p_type IN ('completed', 'failed') THEN
    v_where := format('state = %L AND finished_at_ms <= %s', p_type, p_ts);
    -- Finished jobs are cleaned regardless of scheduler origin (mirrors
    -- cleanJobsInSet-3.lua omitting the repeat key for finished states).
    v_scheduler_filter := '';
  ELSIF p_type = 'delayed' THEN
    v_where := format('state = ''delayed'' AND added_at_ms <= %s', p_ts);
  ELSIF p_type = 'prioritized' THEN
    v_where := format('state = ''waiting'' AND priority > 0 AND added_at_ms <= %s', p_ts);
  ELSIF p_type IN ('wait', 'waiting', 'paused') THEN
    v_where := format('state = ''waiting'' AND priority = 0 AND added_at_ms <= %s', p_ts);
  ELSIF p_type = 'active' THEN
    v_where := format(
      'state = ''active'' AND COALESCE(finished_at_ms, processed_at_ms, added_at_ms) <= %s '
      || 'AND (lock_token IS NULL OR locked_until_ms <= %s)',
      p_ts, (extract(epoch FROM clock_timestamp()) * 1000)::bigint
    );
  ELSE
    RETURN;
  END IF;

  -- Collect the ids to clean (respecting FIFO order + limit).
  EXECUTE format(
    'SELECT array_agg(id) FROM (SELECT id FROM job '
    || 'WHERE queue = %L AND %s %s ORDER BY seq %s) s',
    p_queue, v_where, v_scheduler_filter,
    CASE WHEN p_limit > 0 THEN 'LIMIT ' || p_limit ELSE '' END
  ) INTO v_ids;

  IF v_ids IS NULL THEN
    RETURN;
  END IF;

  -- Distinct parents of the cleaned jobs, for flow-aware release.
  SELECT array_agg(pq), array_agg(pid) INTO v_pq, v_pid FROM (
    SELECT DISTINCT parent_queue AS pq, parent_id AS pid
      FROM job
     WHERE queue = p_queue AND id = ANY(v_ids)
       AND parent_queue IS NOT NULL AND parent_id IS NOT NULL
  ) s;

  -- Break the cleaned jobs' dependency links, then delete the jobs.
  DELETE FROM job_dependency
   WHERE child_queue = p_queue AND child_id = ANY(v_ids);
  DELETE FROM job WHERE queue = p_queue AND id = ANY(v_ids);

  -- Release affected parents: a parent with no remaining pending dependencies
  -- is removed when it lives in the cleaned queue, else moved to wait.
  IF v_pq IS NOT NULL THEN
    FOR i IN 1 .. array_length(v_pq, 1) LOOP
      UPDATE job p SET pending_deps = (
        SELECT count(*) FROM job_dependency d
         WHERE d.parent_queue = v_pq[i] AND d.parent_id = v_pid[i]
           AND d.status = 'pending'
      ) WHERE p.queue = v_pq[i] AND p.id = v_pid[i];

      PERFORM 1 FROM job p
       WHERE p.queue = v_pq[i] AND p.id = v_pid[i]
         AND p.state = 'waiting-children' AND p.pending_deps = 0;
      IF FOUND THEN
        IF v_pq[i] = p_queue THEN
          DELETE FROM job WHERE queue = v_pq[i] AND id = v_pid[i];
        ELSE
          UPDATE job
             SET state = 'waiting', seq = nextval('job_seq')
           WHERE queue = v_pq[i] AND id = v_pid[i];
          PERFORM pg_notify('bullmq_jobs', v_pq[i]);
          PERFORM publish_event(v_pq[i], 'waiting',
            jsonb_build_object('jobId', v_pid[i], 'prev', 'waiting-children'));
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Announce how many jobs were cleaned (mirrors cleanJobsInSet-3.lua's
  -- `cleaned` event; count is a string, as on the Redis stream).
  PERFORM publish_event(p_queue, 'cleaned',
    jsonb_build_object('count', array_length(v_ids, 1)::text));

  RETURN QUERY SELECT unnest(v_ids);
END;
$$;
