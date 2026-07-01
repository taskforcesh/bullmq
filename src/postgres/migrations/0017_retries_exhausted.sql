-- BullMQ PostgreSQL backend — retries-exhausted event (schema version 17).
--
-- A permanent failure (no retries left) emits a 'retries-exhausted' event in
-- addition to 'failed'. Recreate move_to_failed (from 0010) to publish it.
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
  v_state    bullmq_job_state;
  v_lock     text;
  v_dedup_id text;
  v_attempts integer;
BEGIN
  SELECT state, lock_token, dedup_id INTO v_state, v_lock, v_dedup_id
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
   WHERE queue = p_queue AND id = p_id
  RETURNING attempts_made INTO v_attempts;

  PERFORM bullmq_publish_event(p_queue, 'failed',
    jsonb_build_object('jobId', p_id, 'failedReason', p_failed_reason, 'prev', 'active'));

  -- A final failure (reached this function rather than retry/delay) exhausts
  -- the job's attempts.
  PERFORM bullmq_publish_event(p_queue, 'retries-exhausted',
    jsonb_build_object('jobId', p_id, 'attemptsMade', v_attempts));

  -- Propagate the permanent failure to a parent flow job (fpof/cpof/idof/rdof).
  PERFORM bullmq_handle_child_failure(p_queue, p_id, p_failed_reason, p_finished_on);

  PERFORM bullmq_apply_retention(
    p_queue, p_id, 'failed', p_finished_on, p_remove_all, p_keep_age, p_keep_count
  );

  -- Serialize dedup key mutations with concurrent adds for the same id (taken
  -- before requeue's id-counter INCR, matching add_job's advisory→meta order).
  IF v_dedup_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtext('bullmq:dedup:' || p_queue || ':' || v_dedup_id));
  END IF;
  -- Clear a no-ttl deduplication key now that its winner has finished.
  PERFORM bullmq_dedup_finalize(p_queue, v_dedup_id, p_id, p_finished_on);
  -- keepLastIfActive: turn any stashed proto-next into the new winner job.
  PERFORM bullmq_requeue_dedup_next(p_queue, v_dedup_id, p_finished_on);

  -- finishes and nothing is left to run (no active and either paused or no
  -- waiting/prioritized jobs — see bullmq_move_to_completed).
  IF NOT EXISTS (
       SELECT 1 FROM bullmq_job WHERE queue = p_queue AND state = 'active'
     )
     AND (
       EXISTS (
         SELECT 1 FROM bullmq_meta
          WHERE queue = p_queue AND field = 'paused' AND value = '1'
       )
       OR NOT EXISTS (
         SELECT 1 FROM bullmq_job WHERE queue = p_queue AND state = 'waiting'
       )
     ) THEN
    PERFORM bullmq_publish_event(p_queue, 'drained', '{}'::jsonb);
  END IF;

  RETURN p_finished_on;
END;
$$;
