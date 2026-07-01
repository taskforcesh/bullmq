-- BullMQ PostgreSQL backend — job-scheduler protection (schema v22).
--
-- Jobs produced by a job scheduler (those with a non-NULL `scheduler_id`) must
-- not be removed directly, nor swept away by `drain`/`clean`; only the
-- scheduler itself (or its removal) may delete them. This mirrors the Redis
-- behaviour where `removeJob` refuses scheduler jobs and `drain`/`clean` skip
-- them.

-- remove: refuse jobs that belong to a scheduler (ErrorCode -8).
CREATE OR REPLACE FUNCTION bullmq_remove(
  p_queue text, p_id text, p_remove_children boolean
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_locked    boolean;
  v_scheduler text;
  v_dedup_id  text;
  v_deleted   integer;
BEGIN
  SELECT lock_token IS NOT NULL, scheduler_id, dedup_id
    INTO v_locked, v_scheduler, v_dedup_id
    FROM bullmq_job WHERE queue = p_queue AND id = p_id;

  IF v_scheduler IS NOT NULL THEN
    RAISE EXCEPTION 'job belongs to a scheduler'
      USING ERRCODE = 'BM001', DETAIL = '-8';
  END IF;

  IF v_locked THEN
    RETURN 0;
  END IF;

  IF p_remove_children THEN
    DELETE FROM bullmq_job WHERE queue = p_queue AND parent_id = p_id;
  END IF;

  DELETE FROM bullmq_job WHERE queue = p_queue AND id = p_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Clear the deduplication key if this job was its winner.
  PERFORM bullmq_dedup_on_removal(p_queue, p_id, v_dedup_id);

  RETURN v_deleted;
END;
$$;

-- drain: never remove scheduler jobs.
CREATE OR REPLACE FUNCTION bullmq_drain(p_queue text, p_delayed boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_pq  text[];
  v_pid text[];
  i     integer;
BEGIN
  SELECT array_agg(parent_queue), array_agg(parent_id)
    INTO v_pq, v_pid
  FROM (
    SELECT DISTINCT parent_queue, parent_id
      FROM bullmq_job
     WHERE queue = p_queue
       AND parent_id IS NOT NULL
       AND scheduler_id IS NULL
       AND (state = 'waiting' OR (p_delayed AND state = 'delayed'))
  ) s;

  DELETE FROM bullmq_job_dependency d
   USING bullmq_job j
   WHERE j.queue = p_queue
     AND (j.state = 'waiting' OR (p_delayed AND j.state = 'delayed'))
     AND j.parent_id IS NOT NULL
     AND j.scheduler_id IS NULL
     AND d.parent_queue = j.parent_queue
     AND d.parent_id = j.parent_id
     AND d.child_queue = j.queue
     AND d.child_id = j.id;

  DELETE FROM bullmq_job
   WHERE queue = p_queue
     AND scheduler_id IS NULL
     AND (state = 'waiting' OR (p_delayed AND state = 'delayed'));

  IF v_pq IS NOT NULL THEN
    FOR i IN 1 .. array_length(v_pq, 1) LOOP
      UPDATE bullmq_job p
         SET pending_deps = (
           SELECT count(*) FROM bullmq_job_dependency d
            WHERE d.parent_queue = v_pq[i]
              AND d.parent_id = v_pid[i]
              AND d.status = 'pending'
         )
       WHERE p.queue = v_pq[i] AND p.id = v_pid[i];

      PERFORM 1 FROM bullmq_job p
       WHERE p.queue = v_pq[i] AND p.id = v_pid[i]
         AND p.state = 'waiting-children'
         AND p.pending_deps = 0;

      IF FOUND THEN
        IF v_pq[i] = p_queue THEN
          DELETE FROM bullmq_job WHERE queue = v_pq[i] AND id = v_pid[i];
        ELSE
          UPDATE bullmq_job
             SET state = 'waiting', seq = nextval('bullmq_job_seq')
           WHERE queue = v_pq[i] AND id = v_pid[i];
          PERFORM pg_notify('bullmq_jobs', v_pq[i]);
          PERFORM bullmq_publish_event(v_pq[i], 'waiting',
            jsonb_build_object('jobId', v_pid[i], 'prev', 'waiting-children'));
        END IF;
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- clean: never remove scheduler jobs.
CREATE OR REPLACE FUNCTION bullmq_clean(
  p_queue text, p_type text, p_ts bigint, p_limit integer
) RETURNS SETOF text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_where text;
BEGIN
  IF p_type IN ('completed', 'failed') THEN
    v_where := format('state = %L AND finished_at_ms <= %s', p_type, p_ts);
  ELSIF p_type = 'delayed' THEN
    v_where := format('state = ''delayed'' AND added_at_ms <= %s', p_ts);
  ELSIF p_type = 'prioritized' THEN
    v_where := format('state = ''waiting'' AND priority > 0 AND added_at_ms <= %s', p_ts);
  ELSIF p_type IN ('wait', 'waiting', 'paused') THEN
    v_where := format('state = ''waiting'' AND priority = 0 AND added_at_ms <= %s', p_ts);
  ELSIF p_type = 'active' THEN
    v_where := format('state = ''active'' AND added_at_ms <= %s', p_ts);
  ELSE
    RETURN;
  END IF;

  RETURN QUERY EXECUTE format(
    'DELETE FROM bullmq_job WHERE queue = %L AND id IN ('
    || 'SELECT id FROM bullmq_job WHERE queue = %L AND scheduler_id IS NULL AND %s ORDER BY seq '
    || '%s) RETURNING id',
    p_queue, p_queue, v_where,
    CASE WHEN p_limit > 0 THEN 'LIMIT ' || p_limit ELSE '' END
  );
END;
$$;

-- Remove a scheduler and its still-pending job, emitting a `removed` event for
-- each deleted job. Returns 0 if the scheduler existed (removed), 1 otherwise
-- (mirrors removeJobScheduler-3.lua: 0 = OK, 1 = missing).
CREATE FUNCTION bullmq_remove_job_scheduler(
  p_queue text, p_scheduler_id text
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r record;
  v_removed integer;
BEGIN
  FOR r IN
    DELETE FROM bullmq_job
     WHERE queue = p_queue AND scheduler_id = p_scheduler_id
       AND state IN ('delayed', 'waiting')
    RETURNING id, state
  LOOP
    PERFORM bullmq_publish_event(p_queue, 'removed',
      jsonb_build_object('jobId', r.id, 'prev', r.state::text));
  END LOOP;

  DELETE FROM bullmq_scheduler
   WHERE queue = p_queue AND scheduler_id = p_scheduler_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN CASE WHEN v_removed > 0 THEN 0 ELSE 1 END;
END;
$$;
