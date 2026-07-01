-- BullMQ PostgreSQL backend — single-job mutations (schema version 9).
--
-- promote / changeDelay / changePriority validate the job's state and return a
-- status code (0 = ok, or a negative `ErrorCode` the backend maps to the shared
-- error message). Keeping the validation in SQL makes each mutation atomic.

-- ──────────────────────────────────────────────────────────────────────────
-- promote: a delayed job → waiting (process ASAP, keeping its priority).
-- Returns 0 ok, -1 missing (JobNotExist), -3 not delayed (JobNotInState).
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_promote(p_queue text, p_id text) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_state bullmq_job_state;
BEGIN
  SELECT state INTO v_state FROM bullmq_job WHERE queue = p_queue AND id = p_id;
  IF NOT FOUND THEN
    RETURN -1;
  END IF;
  IF v_state <> 'delayed' THEN
    RETURN -3;
  END IF;

  UPDATE bullmq_job
     SET state = 'waiting',
         process_at_ms = NULL,
         delay_ms = 0,
         seq = nextval('bullmq_job_seq')
   WHERE queue = p_queue AND id = p_id;

  PERFORM pg_notify('bullmq_jobs', p_queue);
  PERFORM bullmq_publish_event(p_queue, 'waiting',
    jsonb_build_object('jobId', p_id, 'prev', 'delayed'));
  RETURN 0;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- change_delay: reschedule a delayed job to fire `p_delay` ms from now.
-- Returns 0 ok, -1 missing, -3 not delayed.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_change_delay(
  p_queue text, p_id text, p_delay bigint, p_now bigint
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_state bullmq_job_state;
BEGIN
  SELECT state INTO v_state FROM bullmq_job WHERE queue = p_queue AND id = p_id;
  IF NOT FOUND THEN
    RETURN -1;
  END IF;
  IF v_state <> 'delayed' THEN
    RETURN -3;
  END IF;

  UPDATE bullmq_job
     SET delay_ms = p_delay,
         process_at_ms = p_now + p_delay
   WHERE queue = p_queue AND id = p_id;

  -- Wake any worker blocked on an older (longer) delay so it recomputes.
  PERFORM pg_notify('bullmq_jobs', p_queue);
  RETURN 0;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- change_priority: set a job's priority (and reposition it via lifo) when it is
-- waiting/prioritized; otherwise just record the new priority. Returns 0 ok,
-- -1 missing.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_change_priority(
  p_queue text, p_id text, p_priority integer, p_lifo boolean
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_state bullmq_job_state;
BEGIN
  SELECT state INTO v_state FROM bullmq_job WHERE queue = p_queue AND id = p_id;
  IF NOT FOUND THEN
    RETURN -1;
  END IF;

  IF v_state = 'waiting' THEN
    -- Reposition: lifo → head (negative seq), otherwise → tail (new seq).
    UPDATE bullmq_job
       SET priority = p_priority,
           seq = CASE WHEN p_lifo
                      THEN -nextval('bullmq_job_seq')
                      ELSE nextval('bullmq_job_seq') END
     WHERE queue = p_queue AND id = p_id;
  ELSE
    UPDATE bullmq_job
       SET priority = p_priority
     WHERE queue = p_queue AND id = p_id;
  END IF;

  RETURN 0;
END;
$$;
