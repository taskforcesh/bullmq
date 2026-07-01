-- BullMQ PostgreSQL backend — rate-limit-aware active→wait move (schema v26).
--
-- Recreates bullmq_move_active_to_wait (used by the dynamic/manual rate limit
-- and `Job.moveToWait`) to mirror moveJobFromActiveToWait-9.lua:
--   * A missing job returns -1 (so the caller can raise the canonical
--     "Missing key for job …" error).
--   * A requeued job keeps FIFO order: priority > 0 jobs go to the *front* of
--     their priority group (Redis `pushBackJobWithPriority`), priority 0 jobs go
--     to the tail (Redis `RPUSH`). In the seq model: front = negative seq (sorts
--     before the positive seqs of same-priority jobs), tail = `nextval`.
--   * Returns the remaining limiter window in ms (Redis returns the limiter
--     PTTL), which the worker uses to decide how long to back off.
CREATE OR REPLACE FUNCTION bullmq_move_active_to_wait(
  p_queue text, p_id text, p_token text, p_now bigint
) RETURNS bigint
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_state    bullmq_job_state;
  v_lock     text;
  v_priority integer;
  v_seq      bigint;
  v_expire   bigint;
BEGIN
  SELECT state, lock_token, priority INTO v_state, v_lock, v_priority
    FROM bullmq_job WHERE queue = p_queue AND id = p_id;
  IF NOT FOUND THEN
    RETURN -1;
  END IF;

  IF v_state = 'active'
     AND (p_token = '0' OR v_lock IS NOT DISTINCT FROM p_token) THEN
    IF v_priority > 0 THEN
      v_seq := -nextval('bullmq_job_seq');
    ELSE
      v_seq := nextval('bullmq_job_seq');
    END IF;

    UPDATE bullmq_job
       SET state = 'waiting',
           seq = v_seq,
           lock_token = NULL,
           locked_until_ms = NULL
     WHERE queue = p_queue AND id = p_id;

    PERFORM pg_notify('bullmq_jobs', p_queue);
    PERFORM bullmq_publish_event(p_queue, 'waiting',
      jsonb_build_object('jobId', p_id, 'prev', 'active'));
  END IF;

  -- Remaining limiter window (mirrors Redis returning PTTL of the limiter key).
  SELECT expire_at_ms INTO v_expire
    FROM bullmq_rate_limit WHERE queue = p_queue;
  IF v_expire IS NOT NULL AND v_expire > p_now THEN
    RETURN v_expire - p_now;
  END IF;
  RETURN 0;
END;
$$;
