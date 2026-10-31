-- Finalization may also update a parent in another queue. Coordinate both
-- queues before any row/parent/dedup locks, in actual advisory-key order.
CREATE FUNCTION lock_finalization_queues(p_queue text, p_id text) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_key integer;
BEGIN
  FOR v_key IN
    SELECT DISTINCT hashtext(q)
      FROM (
        SELECT p_queue AS q
        UNION ALL
        SELECT parent_queue FROM job WHERE queue = p_queue AND id = p_id
      ) AS queues
     WHERE q IS NOT NULL
     ORDER BY 1
  LOOP
    PERFORM pg_advisory_xact_lock_shared(hashtext('bullmq:finalization'), v_key);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION move_to_completed(
  p_queue text, p_id text, p_token text, p_return_value jsonb,
  p_finished_on bigint, p_remove_all boolean, p_keep_age bigint,
  p_keep_count integer
) RETURNS bigint
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_state job_state;
  v_lock text;
  v_pq text;
  v_pid text;
  v_dedup_id text;
  v_remaining integer;
BEGIN
  PERFORM lock_finalization_queues(p_queue, p_id);

  SELECT parent_queue, parent_id INTO v_pq, v_pid
    FROM job WHERE queue = p_queue AND id = p_id;
  IF v_pq IS NOT NULL AND v_pid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtext('bullmq:parent:' || v_pq || ':' || v_pid));
  END IF;

  SELECT state, lock_token, parent_queue, parent_id, dedup_id
    INTO v_state, v_lock, v_pq, v_pid, v_dedup_id
    FROM job WHERE queue = p_queue AND id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bullmq: missing job %', p_id USING ERRCODE = 'BM001', DETAIL = '-1';
  END IF;
  IF v_state <> 'active' THEN
    RAISE EXCEPTION 'bullmq: job % not active', p_id USING ERRCODE = 'BM001', DETAIL = '-3';
  END IF;
  IF p_token <> '0' AND v_lock IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'bullmq: job % lock mismatch', p_id USING ERRCODE = 'BM001', DETAIL = '-6';
  END IF;

  IF EXISTS (
    SELECT 1 FROM job_dependency
     WHERE parent_queue = p_queue AND parent_id = p_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'bullmq: job % has pending dependencies', p_id
      USING ERRCODE = 'BM001', DETAIL = '-4';
  END IF;
  IF EXISTS (
    SELECT 1 FROM job_dependency
     WHERE parent_queue = p_queue AND parent_id = p_id AND status = 'failed'
  ) THEN
    RAISE EXCEPTION 'bullmq: job % has failed dependencies', p_id
      USING ERRCODE = 'BM001', DETAIL = '-9';
  END IF;

  UPDATE job
     SET state = 'completed',
         return_value = p_return_value,
         finished_at_ms = p_finished_on,
         lock_token = NULL,
         locked_until_ms = NULL,
         attempts_made = attempts_made + 1
   WHERE queue = p_queue AND id = p_id;

  PERFORM publish_event(p_queue, 'completed',
    jsonb_build_object('jobId', p_id, 'returnvalue',
      COALESCE(p_return_value, 'null'::jsonb)::text, 'prev', 'active'));

  IF v_pid IS NOT NULL AND v_pq IS NOT NULL THEN
    UPDATE job_dependency
       SET status = 'processed', value = p_return_value
     WHERE parent_queue = v_pq AND parent_id = v_pid
       AND child_key = p_queue || ':' || p_id;

    UPDATE job
       SET pending_deps = GREATEST(pending_deps - 1, 0)
     WHERE queue = v_pq AND id = v_pid
    RETURNING pending_deps INTO v_remaining;

    IF v_remaining = 0 THEN
      PERFORM move_parent_to_wait(v_pq, v_pid, p_finished_on);
    END IF;
  END IF;

  PERFORM apply_retention(
    p_queue, p_id, 'completed', p_finished_on, p_remove_all, p_keep_age, p_keep_count
  );

  IF v_dedup_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtext('bullmq:dedup:' || p_queue || ':' || v_dedup_id));
  END IF;
  PERFORM dedup_finalize(p_queue, v_dedup_id, p_id, p_finished_on);
  PERFORM requeue_dedup_next(p_queue, v_dedup_id, p_finished_on);

  IF NOT EXISTS (
       SELECT 1 FROM job WHERE queue = p_queue AND state = 'active'
     )
     AND (
       EXISTS (
         SELECT 1 FROM meta
          WHERE queue = p_queue AND field = 'paused' AND value = '1'
       )
       OR NOT EXISTS (
         SELECT 1 FROM job WHERE queue = p_queue AND state = 'waiting'
       )
     ) THEN
    PERFORM publish_event(p_queue, 'drained', '{}'::jsonb);
  END IF;

  RETURN p_finished_on;
END;
$$;

CREATE OR REPLACE FUNCTION move_to_failed(
  p_queue text, p_id text, p_token text, p_failed_reason text,
  p_stacktrace jsonb, p_finished_on bigint, p_remove_all boolean,
  p_keep_age bigint, p_keep_count integer
) RETURNS bigint
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_state job_state;
  v_lock text;
  v_dedup_id text;
  v_attempts integer;
BEGIN
  PERFORM lock_finalization_queues(p_queue, p_id);

  PERFORM pg_advisory_xact_lock(
    hashtext('bullmq:parent:' || p_queue || ':' || p_id));

  SELECT state, lock_token, dedup_id INTO v_state, v_lock, v_dedup_id
    FROM job WHERE queue = p_queue AND id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bullmq: missing job %', p_id USING ERRCODE = 'BM001', DETAIL = '-1';
  END IF;
  IF v_state <> 'active' THEN
    RAISE EXCEPTION 'bullmq: job % not active', p_id USING ERRCODE = 'BM001', DETAIL = '-3';
  END IF;
  IF p_token <> '0' AND v_lock IS DISTINCT FROM p_token THEN
    RAISE EXCEPTION 'bullmq: job % lock mismatch', p_id USING ERRCODE = 'BM001', DETAIL = '-6';
  END IF;

  UPDATE job
     SET state = 'failed',
         failed_reason = p_failed_reason,
         stacktrace = COALESCE(p_stacktrace, stacktrace),
         finished_at_ms = p_finished_on,
         lock_token = NULL,
         locked_until_ms = NULL,
         deferred_failure = NULL,
         attempts_made = attempts_made + 1
   WHERE queue = p_queue AND id = p_id
  RETURNING attempts_made INTO v_attempts;

  PERFORM publish_event(p_queue, 'failed',
    jsonb_build_object('jobId', p_id, 'failedReason', p_failed_reason, 'prev', 'active'));
  PERFORM publish_event(p_queue, 'retries-exhausted',
    jsonb_build_object('jobId', p_id, 'attemptsMade', v_attempts));
  PERFORM handle_child_failure(p_queue, p_id, p_failed_reason, p_finished_on);
  PERFORM apply_retention(
    p_queue, p_id, 'failed', p_finished_on, p_remove_all, p_keep_age, p_keep_count
  );

  IF v_dedup_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtext('bullmq:dedup:' || p_queue || ':' || v_dedup_id));
  END IF;
  PERFORM dedup_finalize(p_queue, v_dedup_id, p_id, p_finished_on);
  PERFORM requeue_dedup_next(p_queue, v_dedup_id, p_finished_on);

  IF NOT EXISTS (
       SELECT 1 FROM job WHERE queue = p_queue AND state = 'active'
     )
     AND (
       EXISTS (
         SELECT 1 FROM meta
          WHERE queue = p_queue AND field = 'paused' AND value = '1'
       )
       OR NOT EXISTS (
         SELECT 1 FROM job WHERE queue = p_queue AND state = 'waiting'
       )
     ) THEN
    PERFORM publish_event(p_queue, 'drained', '{}'::jsonb);
  END IF;

  RETURN p_finished_on;
END;
$$;

CREATE OR REPLACE FUNCTION obliterate(
  p_queue text, p_count integer, p_force boolean
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_ids text[];
  v_final boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('bullmq:finalization'), hashtext(p_queue));

  IF NOT EXISTS (
    SELECT 1 FROM meta
     WHERE queue = p_queue AND field = 'paused' AND value = '1'
  ) THEN
    RETURN -1;
  END IF;

  IF NOT p_force AND EXISTS (
    SELECT 1 FROM job WHERE queue = p_queue AND state = 'active'
  ) THEN
    RETURN -2;
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::text[]) INTO v_ids
    FROM (
      SELECT id FROM job WHERE queue = p_queue ORDER BY id LIMIT p_count
    ) AS batch;
  v_final := cardinality(v_ids) < p_count;

  IF v_final THEN
    PERFORM dedup_id FROM dedup
     WHERE queue = p_queue
     ORDER BY dedup_id
     FOR UPDATE;
  ELSE
    PERFORM dedup_id FROM dedup
     WHERE queue = p_queue AND job_id = ANY(v_ids)
     ORDER BY dedup_id
     FOR UPDATE;
  END IF;

  DELETE FROM job WHERE queue = p_queue AND id = ANY(v_ids);

  IF NOT v_final THEN
    RETURN 1;
  END IF;

  DELETE FROM scheduler  WHERE queue = p_queue;
  DELETE FROM rate_limit WHERE queue = p_queue;
  DELETE FROM event      WHERE queue = p_queue;
  DELETE FROM metrics    WHERE queue = p_queue;
  DELETE FROM dedup      WHERE queue = p_queue;
  DELETE FROM dedup_next WHERE queue = p_queue;
  DELETE FROM meta       WHERE queue = p_queue;
  EXECUTE format(
    'DROP SEQUENCE IF EXISTS %I', job_id_seq_name(p_queue));
  RETURN 0;
END;
$$;
