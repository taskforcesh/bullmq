-- BullMQ PostgreSQL backend — removeOn* retention (schema version 5).
--
-- `removeOnComplete` / `removeOnFail` control how finished jobs are retained:
--   * true                  → remove the job as soon as it finishes
--   * false / undefined      → keep forever
--   * number N               → keep at most the N most-recent finished jobs
--   * { age }                → keep jobs finished within `age` seconds
--   * { count }              → keep at most `count`
--   * { age, count }         → both
--
-- The backend normalizes the option into (remove_all, keep_age_s, keep_count)
-- and the move_to_completed / move_to_failed functions apply the retention in
-- the same transaction that finishes the job.

-- ──────────────────────────────────────────────────────────────────────────
-- apply_retention: prune finished jobs in a given state according to the
-- removeOn* policy. `remove_all` removes the just-finished job; otherwise an
-- optional age (seconds) and/or count window is enforced.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_apply_retention(
  p_queue       text,
  p_id          text,
  p_state       bullmq_job_state,
  p_now         bigint,
  p_remove_all  boolean,
  p_keep_age    bigint,
  p_keep_count  integer
) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF p_remove_all THEN
    DELETE FROM bullmq_job WHERE queue = p_queue AND id = p_id;
    RETURN;
  END IF;

  IF p_keep_age IS NOT NULL THEN
    DELETE FROM bullmq_job
     WHERE queue = p_queue
       AND state = p_state
       AND finished_at_ms < p_now - p_keep_age * 1000;
  END IF;

  IF p_keep_count IS NOT NULL THEN
    DELETE FROM bullmq_job
     WHERE queue = p_queue
       AND state = p_state
       AND id NOT IN (
         SELECT id FROM bullmq_job
          WHERE queue = p_queue AND state = p_state
          ORDER BY finished_at_ms DESC, seq DESC
          LIMIT p_keep_count
       );
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS bullmq_move_to_completed(text, text, text, jsonb, bigint);

CREATE FUNCTION bullmq_move_to_completed(
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
  v_updated integer;
BEGIN
  UPDATE bullmq_job
     SET state = 'completed',
         return_value = p_return_value,
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

  PERFORM bullmq_apply_retention(
    p_queue, p_id, 'completed', p_finished_on,
    p_remove_all, p_keep_age, p_keep_count
  );

  RETURN p_finished_on;
END;
$$;

DROP FUNCTION IF EXISTS bullmq_move_to_failed(text, text, text, text, jsonb, bigint);

CREATE FUNCTION bullmq_move_to_failed(
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

  PERFORM bullmq_apply_retention(
    p_queue, p_id, 'failed', p_finished_on,
    p_remove_all, p_keep_age, p_keep_count
  );

  RETURN p_finished_on;
END;
$$;
