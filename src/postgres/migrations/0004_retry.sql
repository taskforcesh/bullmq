-- BullMQ PostgreSQL backend — retry / backoff operations (schema version 4).
--
-- The retry *decision* (are there attempts left? what is the backoff delay?)
-- lives in the backend-agnostic `Job.moveToFailed`. It then drives one of three
-- backend operations:
--   * retry with delay  → bullmq_move_to_delayed (re-queue to 'delayed')
--   * retry immediately → bullmq_retry_job        (re-queue to 'waiting')
--   * give up           → bullmq_move_to_failed    (mark 'failed')
--
-- This migration adds the first two and enriches move_to_failed to also persist
-- the stack trace.

-- Replace move_to_failed with a variant that stores the stack trace. The old
-- signature is dropped first (the argument list changed).
DROP FUNCTION IF EXISTS bullmq_move_to_failed(text, text, text, text, bigint);

CREATE FUNCTION bullmq_move_to_failed(
  p_queue         text,
  p_id            text,
  p_token         text,
  p_failed_reason text,
  p_stacktrace    jsonb,
  p_finished_on   bigint
) RETURNS bigint
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE bullmq_job
     SET state = 'failed',
         failed_reason = p_failed_reason,
         stacktrace = COALESCE(p_stacktrace, stacktrace),
         finished_at_ms = p_finished_on,
         lock_token = NULL,
         locked_until_ms = NULL,
         attempts_made = attempts_made + 1
   WHERE queue = p_queue
     AND id = p_id
     AND state = 'active'
     AND lock_token = p_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'bullmq: job % is not active or lock mismatch', p_id
      USING ERRCODE = 'BM001';
  END IF;

  RETURN p_finished_on;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- move_to_delayed: re-queue an active job to the delayed state (retry-with-
-- delay, or a manual delay). `process_at` is when it becomes ready again.
-- Optionally records the failure fields and counts the attempt.
-- Returns 1 on success, 0 if the job was not held by the token.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_move_to_delayed(
  p_queue         text,
  p_id            text,
  p_token         text,
  p_process_at    bigint,
  p_delay         bigint,
  p_skip_attempt  boolean,
  p_failed_reason text,
  p_stacktrace    jsonb
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE bullmq_job
     SET state = 'delayed',
         process_at_ms = p_process_at,
         delay_ms = p_delay,
         failed_reason = COALESCE(p_failed_reason, failed_reason),
         stacktrace = COALESCE(p_stacktrace, stacktrace),
         lock_token = NULL,
         locked_until_ms = NULL,
         attempts_made = attempts_made + (CASE WHEN p_skip_attempt THEN 0 ELSE 1 END)
   WHERE queue = p_queue
     AND id = p_id
     AND state = 'active'
     AND lock_token = p_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'bullmq: job % is not active or lock mismatch', p_id
      USING ERRCODE = 'BM001';
  END IF;

  RETURN v_updated;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- retry_job: re-queue an active job back to waiting immediately (retry now).
-- A fresh `seq` re-orders it (negative for LIFO so it jumps the queue).
-- Optionally records the failure fields and counts the attempt; notifies workers.
-- Returns 1 on success, 0 if the job was not held by the token.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_retry_job(
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
  v_updated integer;
  v_seq     bigint;
BEGIN
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
   WHERE queue = p_queue
     AND id = p_id
     AND state = 'active'
     AND lock_token = p_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'bullmq: job % is not active or lock mismatch', p_id
      USING ERRCODE = 'BM001';
  END IF;

  PERFORM pg_notify('bullmq_jobs', p_queue);
  RETURN v_updated;
END;
$$;
