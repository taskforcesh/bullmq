-- BullMQ PostgreSQL backend — progress/retry/wait follow-ups (schema version 11).
--
--   * update_progress now returns the number of rows updated (0 = missing job),
--     and only emits the 'progress' event when the job exists.
--   * retry_job emits a 'waiting' event so QueueEvents observers see the retry.
--   * move_active_to_wait moves an active job back to wait (Job.moveToWait).

-- update_progress: void → integer (rows updated).
DROP FUNCTION IF EXISTS bullmq_update_progress(text, text, jsonb);
CREATE FUNCTION bullmq_update_progress(
  p_queue    text,
  p_id       text,
  p_progress jsonb
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE bullmq_job SET progress = p_progress
   WHERE queue = p_queue AND id = p_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    PERFORM bullmq_publish_event(p_queue, 'progress',
      jsonb_build_object('jobId', p_id, 'data', p_progress::text));
  END IF;

  RETURN v_updated;
END;
$$;

-- retry_job: re-add the 'waiting' lifecycle event on retry.
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
    jsonb_build_object('jobId', p_id, 'prev', 'failed'));
  RETURN 1;
END;
$$;

-- move_active_to_wait: an active job → waiting (Job.moveToWait). Token '0'
-- bypasses the lock check. Returns the number of rows moved (0 if not active /
-- lock mismatch / missing).
CREATE FUNCTION bullmq_move_active_to_wait(
  p_queue text, p_id text, p_token text
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_moved integer;
BEGIN
  UPDATE bullmq_job
     SET state = 'waiting',
         seq = nextval('bullmq_job_seq'),
         lock_token = NULL,
         locked_until_ms = NULL
   WHERE queue = p_queue AND id = p_id AND state = 'active'
     AND (p_token = '0' OR lock_token = p_token);

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  IF v_moved > 0 THEN
    PERFORM pg_notify('bullmq_jobs', p_queue);
    PERFORM bullmq_publish_event(p_queue, 'waiting',
      jsonb_build_object('jobId', p_id, 'prev', 'active'));
  END IF;
  RETURN v_moved;
END;
$$;
