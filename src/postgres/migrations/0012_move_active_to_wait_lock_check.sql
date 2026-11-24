-- BullMQ PostgreSQL backend: lock check in move_active_to_wait (schema version 12).
--
-- move_active_to_wait (Job.moveToWait / RateLimitError) used to skip the
-- requeue silently when the caller's token did not own the job's lock, and
-- still returned the limiter window, so the caller could not tell the move had
-- not happened. It now mirrors removeLock in moveJobFromActiveToWait-9.lua:
--   * -1 when the job no longer exists,
--   * -2 when the job has no lock (missing lock). An expired lock counts as
--     missing, as on Redis where the lock key's TTL has already removed it,
--     even if stalled recovery has not cleared lock_token yet,
--   * -6 when a live lock is held by another token (lock mismatch).
-- A token of '0' still bypasses the lock check. Same signature as before.
CREATE OR REPLACE FUNCTION move_active_to_wait(
  p_queue text, p_id text, p_token text, p_now bigint
) RETURNS bigint
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_state    job_state;
  v_lock     text;
  v_until    bigint;
  v_priority integer;
  v_seq      bigint;
  v_expire   bigint;
BEGIN
  SELECT state, lock_token, locked_until_ms, priority
    INTO v_state, v_lock, v_until, v_priority
    FROM job WHERE queue = p_queue AND id = p_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN -1;
  END IF;

  IF p_token <> '0' THEN
    IF v_lock IS NULL OR v_until IS NULL OR v_until <= p_now THEN
      RETURN -2;
    ELSIF v_lock <> p_token THEN
      RETURN -6;
    END IF;
  END IF;

  IF v_state = 'active' THEN
    IF v_priority > 0 THEN
      v_seq := -nextval('job_seq');
    ELSE
      v_seq := nextval('job_seq');
    END IF;

    UPDATE job
       SET state = 'waiting',
           seq = v_seq,
           lock_token = NULL,
           locked_until_ms = NULL
     WHERE queue = p_queue AND id = p_id;

    PERFORM pg_notify('bullmq_jobs', p_queue);
    PERFORM publish_event(p_queue, 'waiting',
      jsonb_build_object('jobId', p_id, 'prev', 'active'));
  END IF;

  -- Remaining limiter window (mirrors Redis returning PTTL of the limiter key).
  SELECT expire_at_ms INTO v_expire
    FROM rate_limit WHERE queue = p_queue;
  IF v_expire IS NOT NULL AND v_expire > p_now THEN
    RETURN v_expire - p_now;
  END IF;
  RETURN 0;
END;
$$;
