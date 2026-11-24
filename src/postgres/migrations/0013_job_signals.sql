-- BullMQ PostgreSQL backend: job signals (schema version 13).
--
-- Additive migration: two new tables and two new functions, used by
-- Queue.signal and Job.waitForSignal. Existing functions are unchanged, so
-- clients that don't use signals are unaffected. Mirrors signalJob-11.lua and
-- moveToWaitingForSignal-12.lua.
--
-- Both functions lock the job row first (FOR UPDATE), so storing a signal and
-- checking for it before going to sleep are serialized and a signal is never
-- missed.

-- The latest signal stored on a job for each name.
CREATE TABLE job_signal (
  queue          text   NOT NULL,
  job_id         text   NOT NULL,
  name           text   NOT NULL,
  data           jsonb,
  signaled_at_ms bigint NOT NULL,
  PRIMARY KEY (queue, job_id, name),
  FOREIGN KEY (queue, job_id)
    REFERENCES job (queue, id) ON DELETE CASCADE
);

-- The signal a delayed job is waiting for, and the deadline of the wait.
CREATE TABLE job_signal_wait (
  queue       text   NOT NULL,
  job_id      text   NOT NULL,
  name        text   NOT NULL,
  deadline_ms bigint NOT NULL,
  PRIMARY KEY (queue, job_id),
  FOREIGN KEY (queue, job_id)
    REFERENCES job (queue, id) ON DELETE CASCADE
);

-- Stores a signal and wakes the job if it is delayed waiting for it.
-- Returns 1 woken, 0 stored, -1 missing job, -12 job already finished.
CREATE FUNCTION signal_job(
  p_queue text, p_id text, p_name text, p_data jsonb, p_now bigint
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_state job_state;
BEGIN
  SELECT j.state INTO v_state
    FROM job j WHERE j.queue = p_queue AND j.id = p_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN -1;
  END IF;
  IF v_state IN ('completed', 'failed') THEN
    RETURN -12;
  END IF;

  INSERT INTO job_signal (queue, job_id, name, data, signaled_at_ms)
  VALUES (p_queue, p_id, p_name, p_data, p_now)
  ON CONFLICT (queue, job_id, name)
  DO UPDATE SET data = EXCLUDED.data, signaled_at_ms = EXCLUDED.signaled_at_ms;

  PERFORM publish_event(p_queue, 'signaled',
    jsonb_build_object('jobId', p_id, 'name', p_name));

  -- Only wake the job when it is delayed waiting for this very signal, so a
  -- backoff, a scheduled start or a wait for another signal is never skipped.
  IF v_state = 'delayed' AND EXISTS (
    SELECT 1 FROM job_signal_wait w
     WHERE w.queue = p_queue AND w.job_id = p_id AND w.name = p_name
  ) THEN
    PERFORM promote(p_queue, p_id);
    RETURN 1;
  END IF;

  RETURN 0;
END;
$$;

-- Returns the stored signal, or moves the active job to delayed until the
-- signal arrives or the deadline passes.
-- o_code: 1 signal (o_data is its payload), 0 moved to delayed, 2 timed out,
--         -1 missing job, -2 missing lock, -3 not active, -6 lock mismatch.
CREATE FUNCTION wait_for_signal(
  p_queue text, p_id text, p_token text, p_name text,
  p_timeout bigint, p_now bigint
) RETURNS TABLE (o_code integer, o_data jsonb)
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_state     job_state;
  v_lock      text;
  v_data      jsonb;
  v_wait_name text;
  v_deadline  bigint;
BEGIN
  SELECT j.state, j.lock_token INTO v_state, v_lock
    FROM job j WHERE j.queue = p_queue AND j.id = p_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT -1, NULL::jsonb;
    RETURN;
  END IF;

  SELECT s.data INTO v_data
    FROM job_signal s
   WHERE s.queue = p_queue AND s.job_id = p_id AND s.name = p_name;
  IF FOUND THEN
    DELETE FROM job_signal_wait w WHERE w.queue = p_queue AND w.job_id = p_id;
    RETURN QUERY SELECT 1, v_data;
    RETURN;
  END IF;

  -- Keep the original deadline when the job runs again while waiting for the
  -- same signal, so the timeout is not reset by every rerun.
  SELECT w.name, w.deadline_ms INTO v_wait_name, v_deadline
    FROM job_signal_wait w WHERE w.queue = p_queue AND w.job_id = p_id;
  IF FOUND AND v_wait_name = p_name THEN
    IF p_now >= v_deadline THEN
      DELETE FROM job_signal_wait w WHERE w.queue = p_queue AND w.job_id = p_id;
      RETURN QUERY SELECT 2, NULL::jsonb;
      RETURN;
    END IF;
  ELSE
    v_deadline := p_now + p_timeout;
  END IF;

  IF v_state <> 'active' THEN
    RETURN QUERY SELECT -3, NULL::jsonb;
    RETURN;
  END IF;
  IF p_token <> '0' THEN
    IF v_lock IS NULL THEN
      RETURN QUERY SELECT -2, NULL::jsonb;
      RETURN;
    END IF;
    IF v_lock <> p_token THEN
      RETURN QUERY SELECT -6, NULL::jsonb;
      RETURN;
    END IF;
  END IF;

  PERFORM move_to_delayed(p_queue, p_id, p_token, v_deadline,
    v_deadline - p_now, true, NULL, NULL);

  INSERT INTO job_signal_wait (queue, job_id, name, deadline_ms)
  VALUES (p_queue, p_id, p_name, v_deadline)
  ON CONFLICT (queue, job_id)
  DO UPDATE SET name = EXCLUDED.name, deadline_ms = EXCLUDED.deadline_ms;

  RETURN QUERY SELECT 0, NULL::jsonb;
END;
$$;
