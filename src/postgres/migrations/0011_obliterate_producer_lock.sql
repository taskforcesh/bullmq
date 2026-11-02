CREATE FUNCTION lock_producer_queues(p_entries jsonb) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_key integer;
BEGIN
  FOR v_key IN
    SELECT DISTINCT hashtext(q)
      FROM (
        SELECT entry ->> 'queue' AS q
          FROM jsonb_array_elements(p_entries) AS entries(entry)
        UNION ALL
        SELECT entry ->> 'parentQueue'
          FROM jsonb_array_elements(p_entries) AS entries(entry)
      ) AS queues
     WHERE q IS NOT NULL
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock_shared(
      hashtext('bullmq:finalization'), v_key);
  END LOOP;
END;
$$;

ALTER FUNCTION add_job(
  text, text, text, jsonb, jsonb, integer, bigint, bigint, integer,
  text, text, text, text, text, boolean
) RENAME TO add_job_unlocked;

CREATE FUNCTION add_job(
  p_queue        text,
  p_id           text,
  p_name         text,
  p_data         jsonb,
  p_opts         jsonb,
  p_priority     integer,
  p_delay        bigint,
  p_timestamp    bigint,
  p_max_attempts integer,
  p_parent_queue text,
  p_parent_id    text,
  p_parent_key   text,
  p_dedup_id     text,
  p_scheduler_id text,
  p_lifo         boolean
) RETURNS text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  PERFORM lock_producer_queues(jsonb_build_array(jsonb_build_object(
    'queue', p_queue, 'parentQueue', p_parent_queue)));
  RETURN add_job_unlocked(
    p_queue, p_id, p_name, p_data, p_opts, p_priority, p_delay, p_timestamp,
    p_max_attempts, p_parent_queue, p_parent_id, p_parent_key, p_dedup_id,
    p_scheduler_id, p_lifo);
END;
$$;

ALTER FUNCTION add_flow(jsonb) RENAME TO add_flow_unlocked;

CREATE FUNCTION add_flow(p_entries jsonb) RETURNS SETOF text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  PERFORM lock_producer_queues(p_entries);
  RETURN QUERY SELECT * FROM add_flow_unlocked(p_entries);
END;
$$;
