-- BullMQ PostgreSQL backend — finish-op lock/state semantics (schema version 10).
--
-- Recreates move_to_completed / move_to_failed / move_to_delayed / retry_job so
-- they:
--   * treat the token '0' as a sentinel that bypasses the lock check (matches
--     BullMQ, where '0' means "no lock held"), and
--   * raise *distinct* error codes — JobNotExist (-1), JobNotInState (-3),
--     JobLockMismatch (-6) — carried in the exception DETAIL so the backend can
--     map them to the shared error messages.
--
-- All four use SQLSTATE 'BM001'; the numeric ErrorCode travels in DETAIL.

-- A reusable validation block is inlined in each function (PL/pgSQL has no
-- macro): SELECT ... FOR UPDATE, then existence/active/lock checks.

CREATE OR REPLACE FUNCTION bullmq_move_to_completed(
  p_queue        text,
  p_id           text,
  p_token        text,
  p_return_value jsonb,
  p_finished_on  bigint,
  p_remove_all   boolean,
  p_keep_age     bigint,
  p_keep_count   integer
) RETURNS bigint
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_state bullmq_job_state;
  v_lock  text;
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

  UPDATE bullmq_job
     SET state = 'completed',
         return_value = p_return_value,
         finished_at_ms = p_finished_on,
         lock_token = NULL,
         locked_until_ms = NULL,
         attempts_made = attempts_made + 1
   WHERE queue = p_queue AND id = p_id;

  PERFORM bullmq_publish_event(p_queue, 'completed',
    jsonb_build_object(
      'jobId', p_id,
      'returnvalue', COALESCE(p_return_value, 'null'::jsonb)::text,
      'prev', 'active'
    ));

  PERFORM bullmq_apply_retention(
    p_queue, p_id, 'completed', p_finished_on,
    p_remove_all, p_keep_age, p_keep_count
  );

  RETURN p_finished_on;
END;
$$;

CREATE OR REPLACE FUNCTION bullmq_move_to_failed(
  p_queue         text,
  p_id            text,
  p_token         text,
  p_failed_reason text,
  p_stacktrace    jsonb,
  p_finished_on   bigint,
  p_remove_all    boolean,
  p_keep_age      bigint,
  p_keep_count    integer
) RETURNS bigint
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_state bullmq_job_state;
  v_lock  text;
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

  UPDATE bullmq_job
     SET state = 'failed',
         failed_reason = p_failed_reason,
         stacktrace = COALESCE(p_stacktrace, stacktrace),
         finished_at_ms = p_finished_on,
         lock_token = NULL,
         locked_until_ms = NULL,
         attempts_made = attempts_made + 1
   WHERE queue = p_queue AND id = p_id;

  PERFORM bullmq_publish_event(p_queue, 'failed',
    jsonb_build_object(
      'jobId', p_id,
      'failedReason', p_failed_reason,
      'prev', 'active'
    ));

  PERFORM bullmq_apply_retention(
    p_queue, p_id, 'failed', p_finished_on,
    p_remove_all, p_keep_age, p_keep_count
  );

  RETURN p_finished_on;
END;
$$;

CREATE OR REPLACE FUNCTION bullmq_move_to_delayed(
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
  v_state bullmq_job_state;
  v_lock  text;
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

  UPDATE bullmq_job
     SET state = 'delayed',
         process_at_ms = p_process_at,
         delay_ms = p_delay,
         failed_reason = COALESCE(p_failed_reason, failed_reason),
         stacktrace = COALESCE(p_stacktrace, stacktrace),
         lock_token = NULL,
         locked_until_ms = NULL,
         attempts_made = attempts_made + (CASE WHEN p_skip_attempt THEN 0 ELSE 1 END)
   WHERE queue = p_queue AND id = p_id;

  PERFORM pg_notify('bullmq_jobs', p_queue);
  RETURN 1;
END;
$$;

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
  RETURN 1;
END;
$$;
