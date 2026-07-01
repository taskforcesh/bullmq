-- BullMQ PostgreSQL backend — retry waiting-event prev fix (schema version 18).
--
-- An immediately-retried job transitions active → waiting, so the 'waiting'
-- event's `prev` is 'active' (not 'failed'). Recreate retry_job accordingly.
CREATE OR REPLACE FUNCTION bullmq_retry_job(
  p_queue         text,
  p_id            text,
  p_token         text,
  p_lifo          boolean,
  p_failed_reason text,
  p_stacktrace    jsonb
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_state bullmq_job_state;
  v_lock  text;
  v_seq   bigint;
BEGIN
  SELECT state, lock_token INTO v_state, v_lock
    FROM bullmq_job WHERE queue = p_queue AND id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bullmq: missing job %', p_id USING ERRCODE = 'BM001', DETAIL = '-1';
  END IF;
  IF v_state <> 'active' THEN
    RAISE EXCEPTION 'bullmq: job % not active', p_id USING ERRCODE = 'BM001', DETAIL = '-3';
  END IF;
  IF p_token <> '0' AND v_lock IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'bullmq: job % lock mismatch', p_id USING ERRCODE = 'BM001', DETAIL = '-6';
  END IF;

  v_seq := nextval('bullmq_job_seq');
  IF p_lifo THEN
    v_seq := -v_seq;
  END IF;

  UPDATE bullmq_job
     SET state = 'waiting',
         seq = v_seq,
         process_at_ms = NULL,
         failed_reason = COALESCE(p_failed_reason, failed_reason),
         stacktrace = COALESCE(p_stacktrace, stacktrace),
         lock_token = NULL,
         locked_until_ms = NULL,
         attempts_made = attempts_made + 1
   WHERE queue = p_queue AND id = p_id;

  PERFORM pg_notify('bullmq_jobs', p_queue);
  PERFORM bullmq_publish_event(p_queue, 'waiting',
    jsonb_build_object('jobId', p_id, 'prev', 'active'));
  RETURN 1;
END;
$$;
