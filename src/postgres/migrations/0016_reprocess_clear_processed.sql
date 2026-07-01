-- BullMQ PostgreSQL backend — reprocess clears processedOn (schema version 16).
--
-- Job.retry() must reset processedOn too: a re-queued job is "fresh", so
-- processed_at_ms is cleared alongside finished/return/failed/stacktrace.
CREATE OR REPLACE FUNCTION bullmq_reprocess_job(
  p_queue         text,
  p_id            text,
  p_state         text,
  p_lifo          boolean,
  p_reset_made    boolean,
  p_reset_started boolean
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_state bullmq_job_state;
  v_seq   bigint;
BEGIN
  SELECT state INTO v_state
    FROM bullmq_job WHERE queue = p_queue AND id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN -1;
  END IF;
  IF v_state <> p_state::bullmq_job_state THEN
    RETURN -3;
  END IF;

  v_seq := nextval('bullmq_job_seq');
  IF p_lifo THEN
    v_seq := -v_seq;
  END IF;

  UPDATE bullmq_job
     SET state = 'waiting',
         seq = v_seq,
         process_at_ms = NULL,
         processed_at_ms = NULL,
         finished_at_ms = NULL,
         return_value = NULL,
         failed_reason = NULL,
         stacktrace = NULL,
         attempts_made = CASE WHEN p_reset_made THEN 0 ELSE attempts_made END,
         attempts_started =
           CASE WHEN p_reset_started THEN 0 ELSE attempts_started END
   WHERE queue = p_queue AND id = p_id;

  PERFORM pg_notify('bullmq_jobs', p_queue);
  PERFORM bullmq_publish_event(p_queue, 'waiting',
    jsonb_build_object('jobId', p_id, 'prev', p_state));
  RETURN 1;
END;
$$;
