-- BullMQ PostgreSQL backend — operation functions.
--
-- Every stored function implementing a queue operation (add, move-to-active,
-- finish, flows, scheduler, rate limiting, dedup, metrics, …), in its final
-- form. Depends on the tables/types created in 0001_schema.sql.

-- ──────────────────────────────────────────────────────────────────────────
-- Per-queue job-id allocator
-- ──────────────────────────────────────────────────────────────────────────
-- BullMQ hands auto-generated job ids from a per-queue counter (Redis: INCR
-- <prefix>:<queue>:id). Implementing that as a `bullmq_meta` row bumped with
-- `ON CONFLICT DO UPDATE` serializes *every* concurrent `add` on that row's
-- lock (held until commit), so parallel producers cannot make progress — by far
-- the biggest `add` bottleneck. A dedicated per-queue SEQUENCE hands out ids via
-- `nextval`, which takes no transaction-scoped lock, so concurrent adds run in
-- parallel. Ids are still 1, 2, 3, … per queue (sequence starts at 1), matching
-- Redis; a rolled-back add may leave a gap, exactly as a failed Redis add leaves
-- its INCR in place. The sequence is created lazily on first use and dropped by
-- `bullmq_obliterate`. If we ever need user-facing immutable ids independent from
-- this allocator, we can add a separate custom-id column/index without regressing
-- the hot-path insert concurrency.
CREATE FUNCTION bullmq_job_id_seq_name(p_queue text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT 'bullmq_jid_' || md5(p_queue)
$$;

CREATE FUNCTION bullmq_next_job_id(p_queue text) RETURNS text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_seq text := bullmq_job_id_seq_name(p_queue);
BEGIN
  -- Fast path once the sequence exists: a cached catalog lookup + a lock-free
  -- `nextval`. Only the first add(s) for a queue take the creation path; the
  -- advisory lock serializes those racing first-adds so exactly one issues the
  -- DDL (and it is released the moment that add commits).
  IF to_regclass(v_seq) IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('bullmq:jidseq:' || p_queue));
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', v_seq);
  END IF;
  RETURN nextval(v_seq::regclass)::text;
END;
$$;

-- ── Recreate add_job to run the deduplication decision before inserting.
CREATE OR REPLACE FUNCTION bullmq_add_job(
  p_queue        text,
  p_id           text,
  p_name         text,
  p_data         jsonb,
  p_opts         jsonb,
  p_priority     integer,
  p_delay        bigint,
  p_timestamp    bigint,
  p_max_attempts integer,
  p_parent_queue text,
  p_parent_id    text,
  p_parent_key   text,
  p_dedup_id     text,
  p_scheduler_id text,
  p_lifo         boolean
) RETURNS text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_id    text := p_id;
  v_seq   bigint;
  v_state bullmq_job_state;
  v_process_at bigint;
  v_inserted boolean;
  v_dedup    jsonb;
  v_existing text;
BEGIN
  -- Serialize all dedup operations for this id (mirrors Redis's single-threaded
  -- atomicity: two READ COMMITTED adds could otherwise both read "no live key"
  -- and both insert). Acquired FIRST — before the id-counter INCR below — so the
  -- add and finish paths always take the locks in the same order (advisory then
  -- the id-counter row), which rules out a deadlock with requeue's own INCR.
  -- Transaction-scoped: released when this add commits.
  IF p_dedup_id IS NOT NULL AND p_dedup_id <> '' THEN
    PERFORM pg_advisory_xact_lock(
      hashtext('bullmq:dedup:' || p_queue || ':' || p_dedup_id));
  END IF;

  IF v_id IS NULL OR v_id = '' THEN
    v_id := bullmq_next_job_id(p_queue);
  END IF;

  -- Deduplication: if a live key wins, skip the insert and return its id.
  IF p_dedup_id IS NOT NULL AND p_dedup_id <> '' THEN
    v_dedup := COALESCE(p_opts->'deduplication', p_opts->'debounce',
                        jsonb_build_object('id', p_dedup_id));
    v_existing := bullmq_deduplicate_job(p_queue, v_dedup, v_id, p_timestamp,
      p_name, COALESCE(p_data, '{}'::jsonb), COALESCE(p_opts, '{}'::jsonb));
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  -- Verify the parent exists before inserting (atomic: a failure rolls back).
  IF p_parent_id IS NOT NULL AND p_parent_queue IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM bullmq_job WHERE queue = p_parent_queue AND id = p_parent_id
    ) THEN
      RAISE EXCEPTION 'bullmq: missing parent %', p_parent_key
        USING ERRCODE = 'BM001', DETAIL = '-5';
    END IF;
  END IF;

  v_seq := nextval('bullmq_job_seq');
  IF p_lifo THEN
    v_seq := -v_seq;
  END IF;

  IF p_delay > 0 THEN
    v_state := 'delayed';
    v_process_at := p_timestamp + p_delay;
  ELSE
    v_state := 'waiting';
    v_process_at := NULL;
  END IF;

  INSERT INTO bullmq_job (
    queue, id, seq, name, state,
    data, opts, priority, delay_ms, max_attempts,
    added_at_ms, process_at_ms,
    dedup_id, scheduler_id,
    parent_queue, parent_id, parent_key
  ) VALUES (
    p_queue, v_id, v_seq, p_name, v_state,
    COALESCE(p_data, '{}'::jsonb), COALESCE(p_opts, '{}'::jsonb),
    COALESCE(p_priority, 0), COALESCE(p_delay, 0), COALESCE(p_max_attempts, 1),
    p_timestamp, v_process_at,
    p_dedup_id, p_scheduler_id,
    p_parent_queue, p_parent_id, p_parent_key
  )
  ON CONFLICT (queue, id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted AND p_parent_id IS NOT NULL AND p_parent_queue IS NOT NULL THEN
    INSERT INTO bullmq_job_dependency (
      parent_queue, parent_id, child_queue, child_id, child_key, status
    ) VALUES (
      p_parent_queue, p_parent_id, p_queue, v_id,
      p_queue || ':' || v_id, 'pending'
    )
    ON CONFLICT (parent_queue, parent_id, child_key) DO NOTHING;

    UPDATE bullmq_job
       SET pending_deps = pending_deps + 1
     WHERE queue = p_parent_queue AND id = p_parent_id;
  END IF;

  -- The job already existed: re-attach it to the new parent (or, with no
  -- parent, just announce the duplicate). -7 = it already has a different one.
  IF NOT v_inserted THEN
    IF bullmq_handle_duplicated_job(p_queue, v_id, p_parent_queue,
         p_parent_id, p_parent_key, p_timestamp) = -7 THEN
      RAISE EXCEPTION 'bullmq: parent cannot be replaced'
        USING ERRCODE = 'BM001', DETAIL = '-7';
    END IF;
  END IF;

  IF v_inserted THEN
    PERFORM pg_notify('bullmq_jobs', p_queue);
    -- Every stored job announces itself (mirrors storeJob.lua's 'added').
    PERFORM bullmq_publish_event(p_queue, 'added',
      jsonb_build_object('jobId', v_id, 'name', p_name));
    IF v_state = 'delayed' THEN
      PERFORM bullmq_publish_event(p_queue, 'delayed',
        jsonb_build_object('jobId', v_id, 'delay', v_process_at));
    ELSE
      PERFORM bullmq_publish_event(p_queue, 'waiting',
        jsonb_build_object('jobId', v_id));
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- ── move_to_active with limiter enforcement ────────────────────────────────
-- Adds the limiter: after promoting due delayed jobs, refuse to claim while
-- rate limited (the caller reads the ttl via bullmq_next_signal), and consume a
-- token when a job is claimed. Otherwise identical to the v23 definition.
CREATE OR REPLACE FUNCTION bullmq_move_to_active(
  p_queue            text,
  p_token            text,
  p_lock_ms          bigint,
  p_now              bigint,
  p_name             text,
  p_limiter_max      integer,
  p_limiter_duration bigint
) RETURNS SETOF bullmq_job
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_id       text;
  v_job      bullmq_job;
  v_meta_max integer;
  v_max      integer;
  v_duration bigint;
  v_concurrency integer;
BEGIN
  -- Promote due delayed jobs first, regardless of pause. Redis promotes delayed
  -- jobs via a delay timer that routes through getTargetQueueList, so while the
  -- queue is paused they land in the paused list and still surface (counted as
  -- paused) even though they are not processed. Running this before the pause
  -- early-return reproduces that: the jobs become 'waiting' (reported as paused)
  -- but the claim/activate below is skipped.
  FOR v_id IN
    WITH promoted AS (
      UPDATE bullmq_job
         SET state = 'waiting', delay_ms = 0
       WHERE queue = p_queue
         AND state = 'delayed'
         AND process_at_ms <= p_now
      RETURNING id
    )
    SELECT id FROM promoted
  LOOP
    PERFORM bullmq_publish_event(p_queue, 'waiting',
      jsonb_build_object('jobId', v_id, 'prev', 'delayed'));
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM bullmq_meta
     WHERE queue = p_queue AND field = 'paused' AND value = '1'
  ) THEN
    RETURN;
  END IF;

  -- Global concurrency: never run more than meta.concurrency jobs active at
  -- once (mirrors isQueueMaxed). Serialized per queue with a transaction-scoped
  -- advisory lock so concurrent workers cannot all pass the check and overshoot;
  -- it releases at commit, once this claim is reflected in the active count.
  SELECT value::integer INTO v_concurrency
    FROM bullmq_meta WHERE queue = p_queue AND field = 'concurrency';
  IF v_concurrency IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('bullmq:concurrency:' || p_queue));
    IF (
      SELECT count(*) FROM bullmq_job
       WHERE queue = p_queue AND state = 'active'
    ) >= v_concurrency THEN
      RETURN;
    END IF;
  END IF;

  -- Rate limit: meta `max` wins, else the worker's `limiter.max`.
  SELECT value::integer INTO v_meta_max
    FROM bullmq_meta WHERE queue = p_queue AND field = 'max';
  v_max := COALESCE(v_meta_max, p_limiter_max);

  IF v_max IS NOT NULL THEN
    -- Redis evaluates moveToActive atomically on a single-threaded server, so a
    -- worker's limiter check and its token consumption can never interleave with
    -- another worker's. Postgres runs each worker's call under its own snapshot,
    -- so without serialization several concurrent workers could all read
    -- counter < max, each claim a (distinct) job, and each consume a token —
    -- overshooting the limit. A transaction-scoped advisory lock serializes the
    -- check-and-consume per queue exactly like Redis; under READ COMMITTED the
    -- effective check below then runs on a fresh snapshot that sees the token a
    -- preceding worker just committed. The lock auto-releases at statement end
    -- (this function is always called standalone) and is only taken when a
    -- limiter actually applies, so unlimited queues pay nothing.
    PERFORM pg_advisory_xact_lock(hashtext('bullmq:limiter:' || p_queue));
    IF bullmq_rate_limit_effective(p_queue, p_limiter_max, p_now) > 0 THEN
      RETURN;
    END IF;
  END IF;

  SELECT id INTO v_id
    FROM bullmq_job
   WHERE queue = p_queue AND state = 'waiting'
   ORDER BY priority, seq
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_id IS NULL THEN
    RETURN;
  END IF;

  -- Consume a token now that a job is actually being claimed. Duration: the
  -- worker's `limiter.duration` wins, else meta `duration`.
  IF v_max IS NOT NULL THEN
    SELECT value::bigint INTO v_duration
      FROM bullmq_meta WHERE queue = p_queue AND field = 'duration';
    v_duration := COALESCE(p_limiter_duration, v_duration);
    IF v_duration IS NOT NULL THEN
      PERFORM bullmq_rate_limit_consume(p_queue, v_duration, p_now);
    END IF;
  END IF;

  UPDATE bullmq_job
     SET state = 'active',
         lock_token = p_token,
         locked_until_ms = p_now + p_lock_ms,
         processed_at_ms = p_now,
         processed_by = p_name,
         attempts_started = attempts_started + 1
   WHERE queue = p_queue AND id = v_id
  RETURNING * INTO v_job;

  PERFORM bullmq_publish_event(p_queue, 'active',
    jsonb_build_object('jobId', v_id, 'prev', 'waiting'));

  RETURN NEXT v_job;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- next_delay: the timestamp of the next delayed job (for worker block timing),
-- or NULL when there are none.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_next_delay(p_queue text) RETURNS bigint
LANGUAGE sql
SET search_path FROM CURRENT
AS $$
  SELECT MIN(process_at_ms)
    FROM bullmq_job
   WHERE queue = p_queue AND state = 'delayed';
$$;

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
  v_state    bullmq_job_state;
  v_lock     text;
  v_pq       text;
  v_pid      text;
  v_dedup_id text;
  v_remaining integer;
BEGIN
  -- If this job is a flow child, its parent may be removed concurrently
  -- (`removeOnFail`/`removeOnComplete`), which — via the `ON DELETE CASCADE`
  -- FKs — deletes this job's row and its dependency row while we lock those same
  -- rows below (in the opposite order), deadlocking (SQLSTATE 40P01). Read the
  -- parent first (unlocked, just for the key) and take the per-parent advisory
  -- lock BEFORE any row lock, so a concurrent parent removal and this finish op
  -- serialize. Mirrors Redis's single-threaded atomicity; auto-releases at
  -- commit and is only ever taken on the direct parent (never nested).
  SELECT parent_queue, parent_id INTO v_pq, v_pid
    FROM bullmq_job WHERE queue = p_queue AND id = p_id;
  IF v_pq IS NOT NULL AND v_pid IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtext('bullmq:parent:' || v_pq || ':' || v_pid));
  END IF;

  SELECT state, lock_token, parent_queue, parent_id, dedup_id
    INTO v_state, v_lock, v_pq, v_pid, v_dedup_id
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

  -- A parent cannot complete while it still has unresolved children: pending
  -- children → -4, failed children → -9 (mirrors moveToFinished-14.lua, which
  -- only enforces this on the "completed" path).
  IF EXISTS (
    SELECT 1 FROM bullmq_job_dependency
     WHERE parent_queue = p_queue AND parent_id = p_id AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'bullmq: job % has pending dependencies', p_id
      USING ERRCODE = 'BM001', DETAIL = '-4';
  END IF;
  IF EXISTS (
    SELECT 1 FROM bullmq_job_dependency
     WHERE parent_queue = p_queue AND parent_id = p_id AND status = 'failed'
  ) THEN
    RAISE EXCEPTION 'bullmq: job % has failed dependencies', p_id
      USING ERRCODE = 'BM001', DETAIL = '-9';
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
    jsonb_build_object('jobId', p_id, 'returnvalue',
      COALESCE(p_return_value, 'null'::jsonb)::text, 'prev', 'active'));

  -- Release the parent: mark this child's dependency processed and, if the
  -- parent has no pending deps left and is waiting on children, requeue it.
  -- The per-parent advisory lock taken at the top of this function serializes
  -- these mutations with any sibling finish op and with a concurrent parent
  -- removal, so the decrement cannot deadlock on the parent row.
  IF v_pid IS NOT NULL AND v_pq IS NOT NULL THEN
    UPDATE bullmq_job_dependency
       SET status = 'processed', value = p_return_value
     WHERE parent_queue = v_pq AND parent_id = v_pid
       AND child_key = p_queue || ':' || p_id;

    UPDATE bullmq_job
       SET pending_deps = GREATEST(pending_deps - 1, 0)
     WHERE queue = v_pq AND id = v_pid
    RETURNING pending_deps INTO v_remaining;

    IF v_remaining = 0 THEN
      -- Release the parent (delay-aware: a parent carrying a delay goes to the
      -- delayed set, a prioritized parent keeps its priority).
      PERFORM bullmq_move_parent_to_wait(v_pq, v_pid, p_finished_on);
    END IF;
  END IF;

  PERFORM bullmq_apply_retention(
    p_queue, p_id, 'completed', p_finished_on, p_remove_all, p_keep_age, p_keep_count
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

  -- run, announce the queue is drained. Redis checks the physical wait + active
  -- + prioritized lists; when paused, jobs live in the paused list, so the wait
  -- list is empty and 'drained' still fires. Here that is: no active jobs and
  -- (the queue is paused OR there are no waiting/prioritized jobs).
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
  -- If this job is itself a flow parent, `removeOnFail` (bullmq_apply_retention
  -- below) DELETEs it and, via the `bullmq_job_dependency … ON DELETE CASCADE`
  -- FK, its child-dependency rows. A child finishing concurrently locks that
  -- same dependency row and then this job's row — the opposite order — which
  -- deadlocks (SQLSTATE 40P01). Take the per-parent advisory lock (keyed on this
  -- job, the same key a child's finish op uses for its parent) BEFORE the row
  -- lock below, so the two serialize instead of racing. Mirrors Redis's
  -- single-threaded atomicity; auto-releases at commit.
  PERFORM pg_advisory_xact_lock(
    hashtext('bullmq:parent:' || p_queue || ':' || p_id));

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
         deferred_failure = NULL,
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

-- ──────────────────────────────────────────────────────────────────────────
-- extend_lock: refresh an active job's lock if the token still holds it.
-- Returns 1 on success, 0 if the lock was lost.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_extend_lock(
  p_queue    text,
  p_id       text,
  p_token    text,
  p_lock_ms  bigint,
  p_now      bigint
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE bullmq_job
     SET locked_until_ms = p_now + p_lock_ms
   WHERE queue = p_queue
     AND id = p_id
     AND state = 'active'
     AND lock_token = p_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
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

  -- Announce the delay on the event stream (mirrors moveToDelayed's XADD
  -- 'delayed'); QueueEvents consumers rely on this. `delay` carries the
  -- absolute timestamp the job becomes due, matching the Redis payload.
  PERFORM bullmq_publish_event(p_queue, 'delayed',
    jsonb_build_object('jobId', p_id, 'delay', p_process_at));
  PERFORM pg_notify('bullmq_jobs', p_queue);
  RETURN 1;
END;
$$;

-- BullMQ PostgreSQL backend — retry waiting-event prev fix (schema version 18).
--
-- An immediately-retried job transitions active → waiting, so the 'waiting'
-- event's `prev` is 'active' (not 'failed'). Recreate retry_job accordingly.
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
    jsonb_build_object('jobId', p_id, 'prev', 'active'));
  RETURN 1;
END;
$$;

-- BullMQ PostgreSQL backend — retention age boundary fix (schema version 14).
--
-- Age-based retention keeps jobs finished *within* the last `keep_age` seconds:
-- a job exactly on the boundary (finished_at = now - age*1000) is removed, so
-- the comparison is `<=`, not `<` (matches Redis: keep jobs with score above
-- the cutoff). Otherwise an N-second window keeps N+1 jobs.
CREATE OR REPLACE FUNCTION bullmq_apply_retention(
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
DECLARE
  v_pq        text;
  v_pid       text;
  v_remaining integer;
BEGIN
  IF p_remove_all THEN
    -- If this job is a still-pending child (e.g. a default-failed child with
    -- removeOnFail), detach it and release its parent when it was the last
    -- pending dependency (mirrors removeParentDependencyKey on removal). A
    -- processed/failed dependency is left untouched so the parent keeps it.
    SELECT parent_queue, parent_id INTO v_pq, v_pid
      FROM bullmq_job WHERE queue = p_queue AND id = p_id;
    IF v_pq IS NOT NULL AND v_pid IS NOT NULL THEN
      DELETE FROM bullmq_job_dependency
       WHERE parent_queue = v_pq AND parent_id = v_pid
         AND child_key = p_queue || ':' || p_id
         AND status = 'pending';
      IF FOUND THEN
        UPDATE bullmq_job SET pending_deps = GREATEST(pending_deps - 1, 0)
         WHERE queue = v_pq AND id = v_pid
        RETURNING pending_deps INTO v_remaining;
        IF v_remaining = 0 THEN
          PERFORM bullmq_move_parent_to_wait(v_pq, v_pid, p_now);
        END IF;
      END IF;
    END IF;

    DELETE FROM bullmq_job WHERE queue = p_queue AND id = p_id;
    RETURN;
  END IF;

  IF p_keep_age IS NOT NULL AND p_keep_age >= 0 THEN
    DELETE FROM bullmq_job
     WHERE queue = p_queue
       AND state = p_state
       AND finished_at_ms <= p_now - p_keep_age * 1000;
  END IF;

  -- A negative keep-count is the "keep everything" sentinel (mirrors Redis,
  -- where -1 disables count-based trimming); skip it — a negative SQL LIMIT is
  -- a hard error.
  IF p_keep_count IS NOT NULL AND p_keep_count >= 0 THEN
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

-- BullMQ PostgreSQL backend — event stream (schema version 6).
--
-- QueueEvents consumes an append-only event stream. In Redis this is an XADD
-- stream read with a blocking XREAD; here events live in `bullmq_event` (a
-- globally-ordered id per insert) and blocking reads use LISTEN/NOTIFY on the
-- shared `bullmq_events` channel. This migration adds the publish helper and
-- weaves event emission into the lifecycle operations.

-- ──────────────────────────────────────────────────────────────────────────
-- publish_event: append an event to the stream, notify consumers, and trim the
-- stream to the queue's configured max length (`opts.maxLenEvents`, default
-- 10000). Returns the new event id.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_publish_event(
  p_queue text,
  p_event text,
  p_data  jsonb
) RETURNS bigint
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_id      bigint;
  v_max     integer;
BEGIN
  INSERT INTO bullmq_event (queue, event, data, created_at_ms)
  VALUES (
    p_queue, p_event, COALESCE(p_data, '{}'::jsonb),
    (extract(epoch FROM clock_timestamp()) * 1000)::bigint
  )
  RETURNING id INTO v_id;

  -- Wake event consumers — but coalesce the wakeup under concurrency. Postgres
  -- serializes *every* transaction that issues NOTIFY on a single database-wide
  -- lock at commit (to deliver notifications in commit order), so a NOTIFY on
  -- each of N concurrent workers' commits forces them single-file through that
  -- lock — the dominant processing bottleneck under load (and it caps throughput
  -- across *all* queues and processes, since the lock is global).
  --
  -- A per-queue, transaction-scoped try-lock collapses that: only one committer
  -- per queue actually issues the NOTIFY at a time; concurrent committers skip
  -- it. Skipping is safe because a consumer reads *all* pending events by cursor
  -- on any wake (see readEvents/waitForEvent), and waitForEvent also polls on a
  -- timeout — so a skipped wakeup only defers to the next committer's NOTIFY,
  -- and as concurrency winds down the final committer is uncontended and always
  -- fires. Under low concurrency (e.g. tests) the lock is always free, so every
  -- event notifies exactly as before.
  IF pg_try_advisory_xact_lock(hashtext('bullmq:evnotify:' || p_queue)) THEN
    PERFORM pg_notify('bullmq_events', p_queue);
  END IF;

  SELECT value::integer INTO v_max
    FROM bullmq_meta
   WHERE queue = p_queue AND field = 'opts.maxLenEvents';
  IF v_max IS NULL THEN
    v_max := 10000;
  END IF;

  -- Trim to (approximately) the most recent `v_max` events. `bullmq_event.id`
  -- comes from a monotonic sequence, so the cutoff is simply `id - v_max` — an
  -- O(number-of-deleted-rows) DELETE.
  --
  -- Trimming is *chunked*, not per-publish: only every 256th event even attempts
  -- it. Redis's `XADD MAXLEN ~` likewise trims a whole macro-node at a time
  -- rather than on every add — trimming eagerly turns a bulk/concurrent insert
  -- into a stream of DELETEs that contend (and previously deadlocked) with the
  -- concurrent INSERTs on `bullmq_event`. At 1/256 the table stays within
  -- `v_max + 256`, which is well inside the "approximate" contract. A
  -- non-blocking, per-queue advisory lock further ensures at most one trimmer
  -- per queue at a time; publishers that miss it simply skip (the next one
  -- covers the same rows).
  IF v_max > 0 AND v_id > v_max AND (v_id % 256) = 0 THEN
    IF pg_try_advisory_xact_lock(hashtext('bullmq:evtrim:' || p_queue)) THEN
      DELETE FROM bullmq_event
       WHERE queue = p_queue AND id <= v_id - v_max;
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

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

-- BullMQ PostgreSQL backend — admin operations & getters (schema version 7).
--
-- pause/resume, drain, remove, bulk retry/promote, and the job-id range getter
-- used by getJobs. move_to_active is recreated to honor the paused flag.

-- ──────────────────────────────────────────────────────────────────────────
-- pause: set/clear the queue's paused flag (an O(1) meta flag — no bulk move).
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_pause(p_queue text, p_paused boolean) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF p_paused THEN
    INSERT INTO bullmq_meta (queue, field, value)
    VALUES (p_queue, 'paused', '1')
    ON CONFLICT (queue, field) DO UPDATE SET value = '1';
  ELSE
    -- Resume mirrors Redis `HDEL meta paused`: the field is removed entirely,
    -- so `isPaused` (hasQueueMetaField 'paused') reports false rather than
    -- finding a lingering '0'.
    DELETE FROM bullmq_meta WHERE queue = p_queue AND field = 'paused';

    -- Wake any worker blocked in waitForJob (LISTEN bullmq_jobs): jobs that were
    -- unclaimable only because the queue was paused are now claimable, but no
    -- `add` (which would notify) is involved. Without this the worker sleeps
    -- until its drainDelay times out. The Redis backend wakes the blocking
    -- fetch via a marker on resume; this is the LISTEN/NOTIFY analogue.
    PERFORM pg_notify('bullmq_jobs', p_queue);
  END IF;

  PERFORM bullmq_publish_event(
    p_queue, CASE WHEN p_paused THEN 'paused' ELSE 'resumed' END, '{}'::jsonb
  );
END;
$$;

-- drain: never remove scheduler jobs.
CREATE OR REPLACE FUNCTION bullmq_drain(p_queue text, p_delayed boolean)
RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_pq  text[];
  v_pid text[];
  i     integer;
BEGIN
  SELECT array_agg(parent_queue), array_agg(parent_id)
    INTO v_pq, v_pid
  FROM (
    SELECT DISTINCT parent_queue, parent_id
      FROM bullmq_job
     WHERE queue = p_queue
       AND parent_id IS NOT NULL
       AND scheduler_id IS NULL
       AND (state = 'waiting' OR (p_delayed AND state = 'delayed'))
  ) s;

  DELETE FROM bullmq_job_dependency d
   USING bullmq_job j
   WHERE j.queue = p_queue
     AND (j.state = 'waiting' OR (p_delayed AND j.state = 'delayed'))
     AND j.parent_id IS NOT NULL
     AND j.scheduler_id IS NULL
     AND d.parent_queue = j.parent_queue
     AND d.parent_id = j.parent_id
     AND d.child_queue = j.queue
     AND d.child_id = j.id;

  DELETE FROM bullmq_job
   WHERE queue = p_queue
     AND scheduler_id IS NULL
     AND (state = 'waiting' OR (p_delayed AND state = 'delayed'));

  IF v_pq IS NOT NULL THEN
    FOR i IN 1 .. array_length(v_pq, 1) LOOP
      UPDATE bullmq_job p
         SET pending_deps = (
           SELECT count(*) FROM bullmq_job_dependency d
            WHERE d.parent_queue = v_pq[i]
              AND d.parent_id = v_pid[i]
              AND d.status = 'pending'
         )
       WHERE p.queue = v_pq[i] AND p.id = v_pid[i];

      PERFORM 1 FROM bullmq_job p
       WHERE p.queue = v_pq[i] AND p.id = v_pid[i]
         AND p.state = 'waiting-children'
         AND p.pending_deps = 0;

      IF FOUND THEN
        IF v_pq[i] = p_queue THEN
          DELETE FROM bullmq_job WHERE queue = v_pq[i] AND id = v_pid[i];
        ELSE
          UPDATE bullmq_job
             SET state = 'waiting', seq = nextval('bullmq_job_seq')
           WHERE queue = v_pq[i] AND id = v_pid[i];
          PERFORM pg_notify('bullmq_jobs', v_pq[i]);
          PERFORM bullmq_publish_event(v_pq[i], 'waiting',
            jsonb_build_object('jobId', v_pid[i], 'prev', 'waiting-children'));
        END IF;
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- BullMQ PostgreSQL backend — job-scheduler protection (schema v22).
--
-- Jobs produced by a job scheduler (those with a non-NULL `scheduler_id`) must
-- not be removed directly, nor swept away by `drain`/`clean`; only the
-- scheduler itself (or its removal) may delete them. This mirrors the Redis
-- behaviour where `removeJob` refuses scheduler jobs and `drain`/`clean` skip
-- them.

-- remove: remove a job (and, when requested, its whole flow subtree). Mirrors
-- removeJob-2.lua + removeJobWithChildren:
--   * refuses scheduler jobs (ErrorCode -8);
--   * returns 0 (removes nothing) when the job — or, with removeChildren, any of
--     its still-pending descendants — is locked by a worker; the caller turns
--     this into the "locked by another worker" error;
--   * detaches the removed root from its parent's dependency set and promotes
--     the parent to wait when that clears its last pending dependency;
--   * recursively deletes the subtree (children linked via parent_queue/
--     parent_id) and clears each removed job's deduplication key.
CREATE OR REPLACE FUNCTION bullmq_remove(
  p_queue text, p_id text, p_remove_children boolean
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_found     boolean := false;
  v_scheduler text;
  v_pq        text;
  v_pid       text;
  v_locked    boolean;
  v_remaining integer;
  v_deleted   integer := 0;
  v_now       bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  r           RECORD;
BEGIN
  SELECT true, scheduler_id, parent_queue, parent_id
    INTO v_found, v_scheduler, v_pq, v_pid
    FROM bullmq_job WHERE queue = p_queue AND id = p_id;

  IF NOT COALESCE(v_found, false) THEN
    RETURN 0;
  END IF;

  IF v_scheduler IS NOT NULL THEN
    RAISE EXCEPTION 'job belongs to a scheduler'
      USING ERRCODE = 'BM001', DETAIL = '-8';
  END IF;

  -- Lock check. A job cannot be removed while it is locked; with removeChildren
  -- the check recurses through still-pending descendants (mirrors isLocked()).
  IF p_remove_children THEN
    WITH RECURSIVE subtree AS (
      SELECT p_queue AS q, p_id AS id
      UNION
      SELECT d.child_queue, d.child_id
        FROM subtree s
        JOIN bullmq_job_dependency d
          ON d.parent_queue = s.q AND d.parent_id = s.id
         AND d.status = 'pending'
    )
    SELECT EXISTS (
      SELECT 1 FROM subtree s
       JOIN bullmq_job j ON j.queue = s.q AND j.id = s.id
      WHERE j.lock_token IS NOT NULL AND j.locked_until_ms > v_now
    ) INTO v_locked;
  ELSE
    SELECT lock_token IS NOT NULL AND locked_until_ms > v_now INTO v_locked
      FROM bullmq_job WHERE queue = p_queue AND id = p_id;
  END IF;

  IF v_locked THEN
    RETURN 0;
  END IF;

  -- Detach the removed root from its parent's pending dependency set; if that
  -- clears the parent's last pending dependency, promote it to wait. Only
  -- pending links matter (a processed/failed child was already accounted for).
  IF v_pq IS NOT NULL AND v_pid IS NOT NULL THEN
    DELETE FROM bullmq_job_dependency
     WHERE parent_queue = v_pq AND parent_id = v_pid
       AND child_key = p_queue || ':' || p_id
       AND status = 'pending';
    IF FOUND THEN
      UPDATE bullmq_job SET pending_deps = GREATEST(pending_deps - 1, 0)
       WHERE queue = v_pq AND id = v_pid
      RETURNING pending_deps INTO v_remaining;
      IF v_remaining = 0 THEN
        PERFORM bullmq_move_parent_to_wait(v_pq, v_pid, v_now);
      END IF;
    END IF;
  END IF;

  IF p_remove_children THEN
    -- Delete the whole subtree (root + descendants via parent_queue/parent_id).
    FOR r IN
      WITH RECURSIVE subtree AS (
        SELECT p_queue AS q, p_id AS id, dedup_id AS dd
          FROM bullmq_job WHERE queue = p_queue AND id = p_id
        UNION
        SELECT j.queue, j.id, j.dedup_id
          FROM subtree s
          JOIN bullmq_job j ON j.parent_queue = s.q AND j.parent_id = s.id
      )
      SELECT q, id, dd FROM subtree
    LOOP
      PERFORM bullmq_dedup_on_removal(r.q, r.id, r.dd);
      DELETE FROM bullmq_job WHERE queue = r.q AND id = r.id;
      v_deleted := v_deleted + 1;
    END LOOP;
  ELSE
    PERFORM bullmq_dedup_on_removal(
      p_queue, p_id,
      (SELECT dedup_id FROM bullmq_job WHERE queue = p_queue AND id = p_id));
    DELETE FROM bullmq_job WHERE queue = p_queue AND id = p_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END IF;

  RETURN v_deleted;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- retry_jobs: move up to `count` finished jobs of a state back to waiting.
-- Returns the number moved (the caller loops until it returns 0).
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_retry_jobs(
  p_queue text, p_state text, p_count integer, p_timestamp bigint
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_moved integer;
BEGIN
  WITH batch AS (
    SELECT id FROM bullmq_job
     WHERE queue = p_queue
       AND state = p_state::bullmq_job_state
       AND (p_timestamp IS NULL OR finished_at_ms <= p_timestamp)
     ORDER BY finished_at_ms
     LIMIT p_count
  )
  UPDATE bullmq_job j
     SET state = 'waiting',
         seq = nextval('bullmq_job_seq'),
         finished_at_ms = NULL,
         processed_at_ms = NULL,
         return_value = NULL,
         failed_reason = NULL,
         stacktrace = NULL,
         attempts_made = 0,
         attempts_started = 0,
         lock_token = NULL,
         locked_until_ms = NULL
    FROM batch
   WHERE j.queue = p_queue AND j.id = batch.id;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  IF v_moved > 0 THEN
    PERFORM pg_notify('bullmq_jobs', p_queue);
  END IF;
  RETURN v_moved;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- promote_jobs: move up to `count` delayed jobs to waiting (process now).
-- Returns the number moved (the caller loops until it returns 0).
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_promote_jobs(p_queue text, p_count integer)
RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_moved integer;
BEGIN
  WITH batch AS (
    SELECT id FROM bullmq_job
     WHERE queue = p_queue AND state = 'delayed'
     ORDER BY process_at_ms
     LIMIT p_count
  )
  UPDATE bullmq_job j
     SET state = 'waiting', process_at_ms = NULL, seq = nextval('bullmq_job_seq')
    FROM batch
   WHERE j.queue = p_queue AND j.id = batch.id;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  IF v_moved > 0 THEN
    PERFORM pg_notify('bullmq_jobs', p_queue);
  END IF;
  RETURN v_moved;
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- get_range: the job ids in a given state, sliced by [start, end] (inclusive,
-- zero-based). List-like states (wait/active/waiting-children) are returned in
-- ascending seq order (the getter layer reverses them for `asc`); zset-like
-- states honour the requested direction.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_get_range(
  p_queue text, p_type text, p_start integer, p_end integer, p_asc boolean
) RETURNS SETOF text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_where  text;
  v_order  text;
  v_dir    text := CASE WHEN p_asc THEN 'ASC' ELSE 'DESC' END;
  v_offset integer := GREATEST(COALESCE(p_start, 0), 0);
  v_limit  text;
BEGIN
  -- 'wait'/'active' are list-backed in Redis (LPUSH ⇒ newest at head), and the
  -- shared queue-getters layer reverses these `lrange` results when asc is
  -- requested. Returning newest-first (DESC) here makes that reversal yield the
  -- FIFO order callers expect (getWaiting/getActive), mirroring Redis LRANGE.
  IF p_type IN ('wait', 'waiting') THEN
    v_where := 'state = ''waiting'' AND priority = 0'; v_order := 'seq'; v_dir := 'DESC';
  ELSIF p_type = 'prioritized' THEN
    v_where := 'state = ''waiting'' AND priority > 0'; v_order := 'priority, seq';
  ELSIF p_type = 'active' THEN
    v_where := 'state = ''active'''; v_order := 'seq'; v_dir := 'DESC';
  ELSIF p_type = 'delayed' THEN
    v_where := 'state = ''delayed'''; v_order := 'process_at_ms';
  ELSIF p_type IN ('completed', 'failed') THEN
    v_where := format('state = %L', p_type); v_order := 'finished_at_ms';
  ELSIF p_type = 'waiting-children' THEN
    v_where := 'state = ''waiting-children'''; v_order := 'seq'; v_dir := 'ASC';
  ELSE
    RETURN; -- paused/repeat/unknown
  END IF;

  IF p_end IS NULL OR p_end < 0 THEN
    v_limit := 'ALL';
  ELSE
    IF (p_end - v_offset + 1) <= 0 THEN
      RETURN;
    END IF;
    v_limit := (p_end - v_offset + 1)::text;
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT id FROM bullmq_job WHERE queue = %L AND %s ORDER BY %s %s OFFSET %s LIMIT %s',
    p_queue, v_where, v_order, v_dir, v_offset, v_limit
  );
END;
$$;

-- BullMQ PostgreSQL backend — flows (schema version 8).
--
-- `bullmq_add_flow` atomically inserts a whole tree of jobs (possibly spanning
-- multiple queues) from a single JSONB array of entries, ordered roots-first so
-- a parent always exists before its children register a dependency. `drain` is
-- recreated to be flow-aware: when draining a queue's children resolves a
-- parent's last pending dependency, the parent is removed (same queue) or moved
-- to wait (different queue), mirroring the Redis `removeParentDependencyKey`.

-- ──────────────────────────────────────────────────────────────────────────
-- add_flow: insert an ordered (roots-first) array of flow entries atomically.
-- Returns the resulting job ids in the same order as the input entries.
--
-- Performance: the per-row loop below is what makes flows (parents, dependency
-- links, deduplication, re-parenting) correct, and it already batches the two
-- lifecycle events every insert emits into a single set-based INSERT after the
-- loop (a ~1000-job addBulk drops from ~3000 statement executions to ~1000 job
-- inserts + 1 event insert). That closed most of the gap to Redis on concurrent
-- bulk. Two further, deliberately-deferred iterations could push it further:
--
--   1. A set-based *job* insert for the common flat case (no parent, no dedup):
--      one `INSERT … SELECT FROM jsonb_array_elements(...)` with per-row
--      `nextval` for the id/seq, collapsing the remaining ~1000 job inserts to
--      one statement. It requires a second code path (gated + falling back to
--      this loop) and careful handling of the return-order contract and
--      `ON CONFLICT` on explicit ids — hence deferred until profiling shows the
--      job inserts (not the event stream) dominate.
--   2. An opt-out of the durable event stream (à la Oban's telemetry-only
--      model) for callers that do not use QueueEvents, removing the event
--      insert entirely.
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_add_flow(p_entries jsonb) RETURNS SETOF text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  e              jsonb;
  v_id           text;
  v_seq          bigint;
  v_state        bullmq_job_state;
  v_process_at   bigint;
  v_queue        text;
  v_delay        bigint;
  v_timestamp    bigint;
  v_lifo         boolean;
  v_parent_queue text;
  v_parent_id    text;
  v_awc          boolean;
  v_dedup_id     text;
  v_dedup        jsonb;
  v_winner       text;
  v_inserted     boolean;
  v_code         integer;
  -- Lifecycle-event accumulation. Rather than PERFORM bullmq_publish_event per
  -- job (which turns a 1000-job addBulk into ~2000 extra statement executions —
  -- the dominant cost of a single-connection bulk add), events are collected
  -- here and flushed in ONE set-based INSERT after the loop. Appending to a
  -- plpgsql-local array is amortized O(1) (read-write "expanded array"), so this
  -- stays O(n).
  v_ev_queue     text[]  := '{}';
  v_ev_event     text[]  := '{}';
  v_ev_data      jsonb[] := '{}';
  v_notify_jobs  text[]  := '{}';
  v_max          integer;
BEGIN
  FOR e IN SELECT value FROM jsonb_array_elements(p_entries)
  LOOP
    v_queue        := e ->> 'queue';
    v_id           := COALESCE(e ->> 'id', '');
    v_delay        := COALESCE((e ->> 'delay')::bigint, 0);
    v_timestamp    := COALESCE((e ->> 'timestamp')::bigint, 0);
    v_lifo         := COALESCE((e ->> 'lifo')::boolean, false);
    v_parent_queue := e ->> 'parentQueue';
    v_parent_id    := e ->> 'parentId';
    v_awc          := COALESCE((e ->> 'addToWaitingChildren')::boolean, false);
    v_dedup_id     := e ->> 'dedupId';

    -- Serialize dedup operations for this id (matches add_job and the finish
    -- paths: advisory lock taken before the id-counter INCR below).
    IF v_dedup_id IS NOT NULL AND v_dedup_id <> '' THEN
      PERFORM pg_advisory_xact_lock(
        hashtext('bullmq:dedup:' || v_queue || ':' || v_dedup_id));
    END IF;

    IF v_id IS NULL OR v_id = '' THEN
      v_id := bullmq_next_job_id(v_queue);
    END IF;

    -- Root deduplication: if a live key already won, return its id and skip
    -- inserting this job (and, because it never exists, its descendants).
    IF v_dedup_id IS NOT NULL AND v_dedup_id <> '' THEN
      v_dedup := COALESCE(e -> 'opts' -> 'deduplication',
                          e -> 'opts' -> 'debounce',
                          jsonb_build_object('id', v_dedup_id));
      v_winner := bullmq_deduplicate_job(v_queue, v_dedup, v_id, v_timestamp,
        e ->> 'name', COALESCE((e ->> 'data')::jsonb, '{}'::jsonb),
        COALESCE(e -> 'opts', '{}'::jsonb));
      IF v_winner IS NOT NULL THEN
        RETURN NEXT v_winner;
        CONTINUE;
      END IF;
    END IF;

    -- An entry whose parent does not exist (a child of a deduplicated root, or
    -- a genuinely missing parent) is not inserted; report -5 as addJob does,
    -- without aborting the rest of the flow.
    IF v_parent_id IS NOT NULL AND v_parent_queue IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM bullmq_job
          WHERE queue = v_parent_queue AND id = v_parent_id
       ) THEN
      RETURN NEXT '-5';
      CONTINUE;
    END IF;

    v_seq := nextval('bullmq_job_seq');
    IF v_lifo THEN
      v_seq := -v_seq;
    END IF;

    IF v_awc THEN
      v_state := 'waiting-children';
      v_process_at := NULL;
    ELSIF v_delay > 0 THEN
      v_state := 'delayed';
      v_process_at := v_timestamp + v_delay;
    ELSE
      v_state := 'waiting';
      v_process_at := NULL;
    END IF;

    INSERT INTO bullmq_job (
      queue, id, seq, name, state,
      data, opts, priority, delay_ms, max_attempts,
      added_at_ms, process_at_ms,
      dedup_id, scheduler_id,
      parent_queue, parent_id, parent_key, pending_deps
    ) VALUES (
      v_queue, v_id, v_seq, e ->> 'name', v_state,
      COALESCE((e ->> 'data')::jsonb, '{}'::jsonb),
      COALESCE(e -> 'opts', '{}'::jsonb),
      COALESCE((e ->> 'priority')::integer, 0), v_delay,
      COALESCE((e ->> 'attempts')::integer, 1),
      v_timestamp, v_process_at,
      e ->> 'dedupId', e ->> 'schedulerId',
      v_parent_queue, v_parent_id, e ->> 'parentKey', 0
    )
    ON CONFLICT (queue, id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    IF v_parent_id IS NOT NULL AND v_parent_queue IS NOT NULL THEN
      IF v_inserted THEN
        -- New job: register a pending dependency on its parent.
        INSERT INTO bullmq_job_dependency (
          parent_queue, parent_id, child_queue, child_id, child_key, status
        ) VALUES (
          v_parent_queue, v_parent_id, v_queue, v_id,
          v_queue || ':' || v_id, 'pending'
        )
        ON CONFLICT (parent_queue, parent_id, child_key) DO NOTHING;

        UPDATE bullmq_job
           SET pending_deps = pending_deps + 1
         WHERE queue = v_parent_queue AND id = v_parent_id;
      ELSE
        -- The job already existed: re-attach it to this new parent (mirrors
        -- handleDuplicatedJob). -7 means it already has a different parent.
        v_code := bullmq_handle_duplicated_job(v_queue, v_id,
          v_parent_queue, v_parent_id, e ->> 'parentKey', v_timestamp);
        IF v_code = -7 THEN
          RETURN NEXT '-7';
          CONTINUE;
        END IF;
      END IF;
    END IF;

    -- Accumulate lifecycle events for newly-inserted jobs; they are flushed in
    -- a single set-based INSERT after the loop. Accumulation order (per job:
    -- 'added' then the state event, in job order) is what the flush replays via
    -- WITH ORDINALITY, preserving the stream ordering the per-row publish gave.
    IF v_inserted THEN
      -- Every stored job announces itself (mirrors storeJob.lua's 'added').
      v_ev_queue := array_append(v_ev_queue, v_queue);
      v_ev_event := array_append(v_ev_event, 'added');
      v_ev_data  := array_append(v_ev_data,
        jsonb_build_object('jobId', v_id, 'name', e ->> 'name'));
      IF v_state = 'waiting' THEN
        v_ev_queue    := array_append(v_ev_queue, v_queue);
        v_ev_event    := array_append(v_ev_event, 'waiting');
        v_ev_data     := array_append(v_ev_data,
          jsonb_build_object('jobId', v_id));
        v_notify_jobs := array_append(v_notify_jobs, v_queue);
      ELSIF v_state = 'delayed' THEN
        v_ev_queue    := array_append(v_ev_queue, v_queue);
        v_ev_event    := array_append(v_ev_event, 'delayed');
        v_ev_data     := array_append(v_ev_data,
          jsonb_build_object('jobId', v_id, 'delay', v_process_at));
        v_notify_jobs := array_append(v_notify_jobs, v_queue);
      ELSIF v_state = 'waiting-children' THEN
        v_ev_queue := array_append(v_ev_queue, v_queue);
        v_ev_event := array_append(v_ev_event, 'waiting-children');
        v_ev_data  := array_append(v_ev_data,
          jsonb_build_object('jobId', v_id));
      END IF;
    END IF;

    RETURN NEXT v_id;
  END LOOP;

  -- ── Flush accumulated lifecycle events in one statement ──────────────────
  IF array_length(v_ev_queue, 1) > 0 THEN
    -- Single set-based append. The id DEFAULT nextval('bullmq_event_seq') is
    -- assigned in ordinality order (the ORDER BY pins row-production order), so
    -- the stream keeps each job's 'added' → state-event ordering.
    INSERT INTO bullmq_event (queue, event, data, created_at_ms)
    SELECT q, ev, dat, (extract(epoch FROM clock_timestamp()) * 1000)::bigint
      FROM unnest(v_ev_queue, v_ev_event, v_ev_data)
             WITH ORDINALITY AS t(q, ev, dat, ord)
     ORDER BY ord;

    -- One 'bullmq_events' wakeup per distinct queue, then trim that queue's
    -- stream once (not per publish). A non-blocking advisory lock keeps at most
    -- one trimmer per queue; publishers that miss it skip (the next flush covers
    -- the same rows). Matches bullmq_publish_event's approximate-MAXLEN trim.
    FOR v_queue IN SELECT DISTINCT q FROM unnest(v_ev_queue) AS q LOOP
      PERFORM pg_notify('bullmq_events', v_queue);

      SELECT value::integer INTO v_max
        FROM bullmq_meta
       WHERE queue = v_queue AND field = 'opts.maxLenEvents';
      IF v_max IS NULL THEN
        v_max := 10000;
      END IF;
      IF v_max > 0
         AND pg_try_advisory_xact_lock(hashtext('bullmq:evtrim:' || v_queue))
      THEN
        DELETE FROM bullmq_event
         WHERE queue = v_queue
           AND id <= (SELECT max(id) FROM bullmq_event WHERE queue = v_queue)
                     - v_max;
      END IF;
    END LOOP;

    -- One 'bullmq_jobs' wakeup per distinct queue that gained a runnable job.
    FOR v_queue IN SELECT DISTINCT q FROM unnest(v_notify_jobs) AS q LOOP
      PERFORM pg_notify('bullmq_jobs', v_queue);
    END LOOP;
  END IF;
END;
$$;

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

-- BullMQ PostgreSQL backend — reprocess clears processedOn (schema version 16).
--
-- Job.retry() must reset processedOn too: a re-queued job is "fresh", so
-- processed_at_ms is cleared alongside finished/return/failed/stacktrace.
CREATE OR REPLACE FUNCTION bullmq_reprocess_job(
  p_queue         text,
  p_id            text,
  p_state         text,
  p_lifo          boolean,
  p_reset_made    boolean,
  p_reset_started boolean
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_state bullmq_job_state;
  v_seq   bigint;
  v_pq    text;
  v_pid   text;
BEGIN
  SELECT state, parent_queue, parent_id INTO v_state, v_pq, v_pid
    FROM bullmq_job WHERE queue = p_queue AND id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN -1;
  END IF;
  IF v_state <> p_state::bullmq_job_state THEN
    RETURN -3;
  END IF;

  v_seq := nextval('bullmq_job_seq');
  IF p_lifo THEN
    v_seq := -v_seq;
  END IF;

  UPDATE bullmq_job
     SET state = 'waiting',
         seq = v_seq,
         process_at_ms = NULL,
         processed_at_ms = NULL,
         finished_at_ms = NULL,
         return_value = NULL,
         failed_reason = NULL,
         stacktrace = NULL,
         attempts_made = CASE WHEN p_reset_made THEN 0 ELSE attempts_made END,
         attempts_started =
           CASE WHEN p_reset_started THEN 0 ELSE attempts_started END
   WHERE queue = p_queue AND id = p_id;

  -- A retried child must be awaited again by its parent: move its dependency
  -- back to pending and re-count it (mirrors reprocessJob-8.lua re-adding the
  -- job to the parent's :dependencies set).
  IF v_pq IS NOT NULL AND v_pid IS NOT NULL
     AND EXISTS (SELECT 1 FROM bullmq_job WHERE queue = v_pq AND id = v_pid) THEN
    UPDATE bullmq_job_dependency
       SET status = 'pending', value = NULL
     WHERE parent_queue = v_pq AND parent_id = v_pid
       AND child_key = p_queue || ':' || p_id
       AND status = (CASE WHEN p_state = 'failed' THEN 'failed'
                          ELSE 'processed' END)::bullmq_dep_status;
    IF FOUND THEN
      UPDATE bullmq_job SET pending_deps = pending_deps + 1
       WHERE queue = v_pq AND id = v_pid;
    END IF;
  END IF;

  PERFORM pg_notify('bullmq_jobs', p_queue);
  PERFORM bullmq_publish_event(p_queue, 'waiting',
    jsonb_build_object('jobId', p_id, 'prev', p_state));
  RETURN 1;
END;
$$;

-- BullMQ PostgreSQL backend — step jobs / waiting-children (schema version 19).
--
--   * move_to_waiting_children: a parent with pending children → waiting-children
--     (returns 1 = should wait); no pending → 0 = proceed.
--   * move_to_completed also releases the parent: a completing child marks its
--     dependency processed and, when the parent has no pending deps left and is
--     waiting-children, promotes it back to waiting.
CREATE FUNCTION bullmq_move_to_waiting_children(
  p_queue text, p_id text, p_token text
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_state   bullmq_job_state;
  v_lock    text;
  v_pending integer;
BEGIN
  SELECT state, lock_token, pending_deps INTO v_state, v_lock, v_pending
    FROM bullmq_job WHERE queue = p_queue AND id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bullmq: missing job %', p_id USING ERRCODE = 'BM001', DETAIL = '-1';
  END IF;
  -- A parent with a failed child (failParentOnFailure) can never complete its
  -- children step; surface it as an unrecoverable failure (mirrors the
  -- `:unsuccessful` set check in moveToWaitingChildren-7.lua).
  IF EXISTS (
    SELECT 1 FROM bullmq_job_dependency
     WHERE parent_queue = p_queue AND parent_id = p_id AND status = 'failed'
  ) THEN
    RAISE EXCEPTION 'bullmq: job % has failed children', p_id
      USING ERRCODE = 'BM001', DETAIL = '-9';
  END IF;
  -- Lock check (mirrors removeLock, taken before the active-state check): a
  -- missing lock is -2, a mismatched one is -6; token '0' skips the check.
  IF p_token <> '0' THEN
    IF v_lock IS NULL THEN
      RAISE EXCEPTION 'bullmq: job % missing lock', p_id
        USING ERRCODE = 'BM001', DETAIL = '-2';
    ELSIF v_lock <> p_token THEN
      RAISE EXCEPTION 'bullmq: job % lock mismatch', p_id
        USING ERRCODE = 'BM001', DETAIL = '-6';
    END IF;
  END IF;
  IF v_state <> 'active' THEN
    RAISE EXCEPTION 'bullmq: job % not active', p_id USING ERRCODE = 'BM001', DETAIL = '-3';
  END IF;

  IF v_pending > 0 THEN
    UPDATE bullmq_job
       SET state = 'waiting-children', lock_token = NULL, locked_until_ms = NULL
     WHERE queue = p_queue AND id = p_id;
    RETURN 1; -- should wait
  END IF;

  RETURN 0; -- no pending children: proceed
END;
$$;

-- clean: skip a job scheduler's still-pending jobs, but clean finished ones.
-- Flow-aware: when a cleaned job is a pending child, its parent's dependency
-- count is updated and the parent released (removed if it lives in the cleaned
-- queue, otherwise moved to wait) — mirrors removeJob → removeParentDependencyKey.
CREATE OR REPLACE FUNCTION bullmq_clean(
  p_queue text, p_type text, p_ts bigint, p_limit integer
) RETURNS SETOF text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_where             text;
  v_scheduler_filter  text := 'AND scheduler_id IS NULL';
  v_ids               text[];
  v_pq                text[];
  v_pid               text[];
  i                   integer;
BEGIN
  IF p_type IN ('completed', 'failed') THEN
    v_where := format('state = %L AND finished_at_ms <= %s', p_type, p_ts);
    -- Finished jobs are cleaned regardless of scheduler origin (mirrors
    -- cleanJobsInSet-3.lua omitting the repeat key for finished states).
    v_scheduler_filter := '';
  ELSIF p_type = 'delayed' THEN
    v_where := format('state = ''delayed'' AND added_at_ms <= %s', p_ts);
  ELSIF p_type = 'prioritized' THEN
    v_where := format('state = ''waiting'' AND priority > 0 AND added_at_ms <= %s', p_ts);
  ELSIF p_type IN ('wait', 'waiting', 'paused') THEN
    v_where := format('state = ''waiting'' AND priority = 0 AND added_at_ms <= %s', p_ts);
  ELSIF p_type = 'active' THEN
    v_where := format('state = ''active'' AND added_at_ms <= %s', p_ts);
  ELSE
    RETURN;
  END IF;

  -- Collect the ids to clean (respecting FIFO order + limit).
  EXECUTE format(
    'SELECT array_agg(id) FROM (SELECT id FROM bullmq_job '
    || 'WHERE queue = %L AND %s %s ORDER BY seq %s) s',
    p_queue, v_where, v_scheduler_filter,
    CASE WHEN p_limit > 0 THEN 'LIMIT ' || p_limit ELSE '' END
  ) INTO v_ids;

  IF v_ids IS NULL THEN
    RETURN;
  END IF;

  -- Distinct parents of the cleaned jobs, for flow-aware release.
  SELECT array_agg(pq), array_agg(pid) INTO v_pq, v_pid FROM (
    SELECT DISTINCT parent_queue AS pq, parent_id AS pid
      FROM bullmq_job
     WHERE queue = p_queue AND id = ANY(v_ids)
       AND parent_queue IS NOT NULL AND parent_id IS NOT NULL
  ) s;

  -- Break the cleaned jobs' dependency links, then delete the jobs.
  DELETE FROM bullmq_job_dependency
   WHERE child_queue = p_queue AND child_id = ANY(v_ids);
  DELETE FROM bullmq_job WHERE queue = p_queue AND id = ANY(v_ids);

  -- Release affected parents: a parent with no remaining pending dependencies
  -- is removed when it lives in the cleaned queue, else moved to wait.
  IF v_pq IS NOT NULL THEN
    FOR i IN 1 .. array_length(v_pq, 1) LOOP
      UPDATE bullmq_job p SET pending_deps = (
        SELECT count(*) FROM bullmq_job_dependency d
         WHERE d.parent_queue = v_pq[i] AND d.parent_id = v_pid[i]
           AND d.status = 'pending'
      ) WHERE p.queue = v_pq[i] AND p.id = v_pid[i];

      PERFORM 1 FROM bullmq_job p
       WHERE p.queue = v_pq[i] AND p.id = v_pid[i]
         AND p.state = 'waiting-children' AND p.pending_deps = 0;
      IF FOUND THEN
        IF v_pq[i] = p_queue THEN
          DELETE FROM bullmq_job WHERE queue = v_pq[i] AND id = v_pid[i];
        ELSE
          UPDATE bullmq_job
             SET state = 'waiting', seq = nextval('bullmq_job_seq')
           WHERE queue = v_pq[i] AND id = v_pid[i];
          PERFORM pg_notify('bullmq_jobs', v_pq[i]);
          PERFORM bullmq_publish_event(v_pq[i], 'waiting',
            jsonb_build_object('jobId', v_pid[i], 'prev', 'waiting-children'));
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Announce how many jobs were cleaned (mirrors cleanJobsInSet-3.lua's
  -- `cleaned` event; count is a string, as on the Redis stream).
  PERFORM bullmq_publish_event(p_queue, 'cleaned',
    jsonb_build_object('count', array_length(v_ids, 1)::text));

  RETURN QUERY SELECT unnest(v_ids);
END;
$$;

-- Mirror of the Lua getJobSchedulerEveryNextMillis: returns the next due time
-- for a fixed-interval scheduler and the aligned offset, as a 2-int array.
CREATE FUNCTION bullmq_scheduler_every_next_millis(
  p_prev bigint, p_every bigint, p_now bigint, p_offset bigint, p_start bigint
) RETURNS bigint[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_next   bigint;
  v_offset bigint := p_offset;
BEGIN
  IF p_prev IS NULL THEN
    IF p_start IS NOT NULL THEN
      v_next := GREATEST(p_start, p_now);
    ELSE
      v_next := p_now;
      IF p_offset IS NOT NULL AND p_offset > 0 THEN
        v_next := (p_now / p_every) * p_every + p_offset;
        IF v_next <= p_now THEN
          v_next := v_next + p_every;
        END IF;
      END IF;
    END IF;
  ELSE
    v_next := p_prev + p_every;
    IF v_next < p_now THEN
      v_next := (p_now / p_every) * p_every + p_every + COALESCE(p_offset, 0);
    END IF;
  END IF;

  IF v_offset IS NULL OR v_offset = 0 THEN
    v_offset := v_next - (v_next / p_every) * p_every;
  END IF;

  RETURN ARRAY[v_next, v_offset];
END;
$$;

-- Registers/updates a scheduler and enqueues its next delayed job.
-- Returns (job_id, delay).
CREATE FUNCTION bullmq_add_job_scheduler(
  p_queue         text,
  p_scheduler_id  text,
  p_next_millis   bigint,
  p_template_data jsonb,
  p_template_opts jsonb,
  p_opts          jsonb,
  p_delayed_opts  jsonb,
  p_now           bigint,
  p_producer_id   text
) RETURNS TABLE (job_id text, delay bigint)
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_name    text    := p_opts ->> 'name';
  v_tz      text    := p_opts ->> 'tz';
  v_pattern text    := p_opts ->> 'pattern';
  v_every   bigint  := (p_opts ->> 'every')::bigint;
  v_offset  bigint  := COALESCE((p_opts ->> 'offset')::bigint,
                                (p_delayed_opts #>> '{repeat,offset}')::bigint, 0);
  v_offset_provided boolean := (p_opts ->> 'offset') IS NOT NULL
                            OR (p_delayed_opts #>> '{repeat,offset}') IS NOT NULL;
  v_start   bigint  := (p_opts ->> 'startDate')::bigint;
  v_end     bigint  := (p_opts ->> 'endDate')::bigint;
  v_limit   integer := (p_opts ->> 'limit')::integer;
  v_prev    bigint;
  v_millis  bigint;
  v_prev_every bigint;
  v_existing_offset bigint;
  v_ic      integer;
  v_next    bigint  := p_next_millis;
  v_updated_every boolean := false;
  v_removed boolean := false;
  v_collision boolean := false;
  v_new_offset bigint := v_offset;
  v_em      bigint[];
  v_jobid   text;
  v_delay   bigint;
  v_state   bullmq_job_state;
  v_seq     bigint;
BEGIN
  SELECT next_run_ms, every_ms, iteration_count, offset_ms
    INTO v_prev, v_prev_every, v_ic, v_existing_offset
    FROM bullmq_scheduler WHERE queue = p_queue AND scheduler_id = p_scheduler_id;

  -- `v_prev` is the previous iteration (used for removal); `v_millis` seeds the
  -- `every` formula and is reset to NULL when the interval itself changed.
  v_millis := v_prev;
  IF v_every IS NOT NULL THEN
    IF v_prev IS NOT NULL AND v_prev_every IS DISTINCT FROM v_every THEN
      v_millis := NULL;
      v_updated_every := true;
    END IF;
    v_em := bullmq_scheduler_every_next_millis(v_millis, v_every, p_now, v_offset, v_start);
    v_next := v_em[1];
    v_new_offset := v_em[2];
    -- Preserve the offset established at scheduler creation. On re-upsert of an
    -- existing scheduler without an explicit offset, keep the stored offset
    -- instead of recomputing it against the (possibly changed) `every`. Mirrors
    -- Redis storeJobScheduler, which writes a freshly-computed offset only on
    -- first creation and otherwise preserves the existing hash field.
    IF NOT v_offset_provided AND v_existing_offset IS NOT NULL THEN
      v_new_offset := v_existing_offset;
    END IF;
  END IF;

  -- Remove the previous iteration's (still-pending) job, if any.
  IF v_prev IS NOT NULL THEN
    DELETE FROM bullmq_job
     WHERE queue = p_queue
       AND id = 'repeat:' || p_scheduler_id || ':' || v_prev
       AND state IN ('delayed', 'waiting');
    IF FOUND THEN
      v_removed := true;
    END IF;
  END IF;

  IF v_removed AND v_every IS NOT NULL AND NOT v_updated_every THEN
    v_next := v_prev;
  END IF;

  -- Collision: a job with the next id already exists in a non-replaceable state
  -- (e.g. it is active). For `every` we try the following slot; for `pattern`
  -- we fail — unless we just removed the previous job (override replaces it).
  v_jobid := 'repeat:' || p_scheduler_id || ':' || v_next;
  IF EXISTS (SELECT 1 FROM bullmq_job WHERE queue = p_queue AND id = v_jobid) THEN
    IF v_every IS NOT NULL THEN
      v_next := v_next + v_every;
      v_jobid := 'repeat:' || p_scheduler_id || ':' || v_next;
      IF EXISTS (SELECT 1 FROM bullmq_job WHERE queue = p_queue AND id = v_jobid) THEN
        RAISE EXCEPTION 'scheduler job slots busy'
          USING ERRCODE = 'BM001', DETAIL = '-11';
      END IF;
    ELSIF NOT v_removed THEN
      RAISE EXCEPTION 'scheduler job id collision'
        USING ERRCODE = 'BM001', DETAIL = '-10';
    ELSE
      v_collision := true;
    END IF;
  END IF;

  v_delay := GREATEST(v_next - p_now, 0);

  -- Upsert the scheduler row (iteration count preserved, or 1 the first time).
  INSERT INTO bullmq_scheduler (
    queue, scheduler_id, name, next_run_ms, pattern, every_ms, tz,
    start_date_ms, end_date_ms, limit_count, iteration_count, offset_ms,
    template_data, template_opts, producer_id
  ) VALUES (
    p_queue, p_scheduler_id, v_name, v_next, v_pattern, v_every, v_tz,
    v_start, v_end, v_limit, COALESCE(v_ic, 1), v_new_offset,
    p_template_data, p_template_opts, p_producer_id
  )
  ON CONFLICT (queue, scheduler_id) DO UPDATE SET
    name = EXCLUDED.name,
    next_run_ms = EXCLUDED.next_run_ms,
    pattern = EXCLUDED.pattern,
    every_ms = EXCLUDED.every_ms,
    tz = EXCLUDED.tz,
    start_date_ms = EXCLUDED.start_date_ms,
    end_date_ms = EXCLUDED.end_date_ms,
    limit_count = EXCLUDED.limit_count,
    offset_ms = EXCLUDED.offset_ms,
    template_data = EXCLUDED.template_data,
    template_opts = EXCLUDED.template_opts,
    producer_id = EXCLUDED.producer_id;

  -- Create the next delayed (or immediately-ready) job. When `v_collision` we
  -- are replacing an existing (removed-prev) row, so fully reset it.
  v_seq := nextval('bullmq_job_seq');
  IF v_delay > 0 THEN
    v_state := 'delayed';
  ELSE
    v_state := 'waiting';
  END IF;

  INSERT INTO bullmq_job (
    queue, id, seq, name, state, data, opts, priority, delay_ms, max_attempts,
    added_at_ms, process_at_ms, scheduler_id
  ) VALUES (
    p_queue, v_jobid, v_seq, v_name, v_state,
    COALESCE(p_template_data, '{}'::jsonb),
    COALESCE(p_delayed_opts, '{}'::jsonb)
      || jsonb_build_object('delay', v_delay, 'jobId', v_jobid),
    COALESCE((p_delayed_opts ->> 'priority')::integer, 0), v_delay,
    COALESCE((p_delayed_opts ->> 'attempts')::integer, 1),
    COALESCE((p_delayed_opts ->> 'timestamp')::bigint, p_now),
    CASE WHEN v_delay > 0 THEN v_next ELSE NULL END, p_scheduler_id
  )
  ON CONFLICT (queue, id) DO UPDATE SET
    seq = EXCLUDED.seq,
    name = EXCLUDED.name,
    state = EXCLUDED.state,
    data = EXCLUDED.data,
    opts = EXCLUDED.opts,
    priority = EXCLUDED.priority,
    delay_ms = EXCLUDED.delay_ms,
    max_attempts = EXCLUDED.max_attempts,
    attempts_made = 0,
    attempts_started = 0,
    added_at_ms = EXCLUDED.added_at_ms,
    process_at_ms = EXCLUDED.process_at_ms,
    processed_at_ms = NULL,
    finished_at_ms = NULL,
    return_value = NULL,
    failed_reason = NULL,
    stacktrace = NULL,
    lock_token = NULL,
    locked_until_ms = NULL,
    stalled_count = 0,
    processed_by = NULL,
    scheduler_id = EXCLUDED.scheduler_id;

  PERFORM pg_notify('bullmq_jobs', p_queue);

  job_id := v_jobid;
  delay := v_delay;
  RETURN NEXT;
END;
$$;

-- Advance an existing scheduler to its next iteration (no template change).
-- Returns the new job id, or NULL if the scheduler no longer exists.
CREATE FUNCTION bullmq_update_job_scheduler_next_millis(
  p_queue         text,
  p_scheduler_id  text,
  p_next_millis   bigint,
  p_template_data jsonb,
  p_delayed_opts  jsonb,
  p_now           bigint,
  p_producer_id   text
) RETURNS text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_name   text;
  v_prev   bigint;
  v_every  bigint;
  v_start  bigint;
  v_offset bigint;
  v_data   jsonb;
  v_next   bigint := p_next_millis;
  v_new_offset bigint;
  v_em     bigint[];
  v_jobid  text;
  v_current text;
  v_delay  bigint;
  v_state  bullmq_job_state;
  v_seq    bigint;
BEGIN
  SELECT name, next_run_ms, every_ms, start_date_ms, offset_ms, template_data
    INTO v_name, v_prev, v_every, v_start, v_offset, v_data
    FROM bullmq_scheduler WHERE queue = p_queue AND scheduler_id = p_scheduler_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_every IS NULL THEN
    v_every := (p_delayed_opts #>> '{repeat,every}')::bigint;
  END IF;

  IF v_every IS NOT NULL THEN
    v_offset := COALESCE(v_offset, (p_delayed_opts #>> '{repeat,offset}')::bigint, 0);
    v_em := bullmq_scheduler_every_next_millis(v_prev, v_every, p_now, v_offset, v_start);
    v_next := v_em[1];
    v_new_offset := v_em[2];
  END IF;

  -- Only the producer of the current iteration may advance the scheduler;
  -- this guards against duplicate iterations from stale/concurrent finishes.
  v_current := 'repeat:' || p_scheduler_id || ':' || v_prev;
  IF p_producer_id IS DISTINCT FROM v_current THEN
    RETURN NULL;
  END IF;

  v_jobid := 'repeat:' || p_scheduler_id || ':' || v_next;

  -- If the next iteration's job already exists, this is a duplicate.
  IF EXISTS (SELECT 1 FROM bullmq_job WHERE queue = p_queue AND id = v_jobid) THEN
    PERFORM bullmq_publish_event(p_queue, 'duplicated',
      jsonb_build_object('jobId', v_jobid));
    RETURN NULL;
  END IF;

  v_delay := GREATEST(v_next - p_now, 0);

  UPDATE bullmq_scheduler
     SET next_run_ms = v_next,
         iteration_count = iteration_count + 1,
         offset_ms = COALESCE(offset_ms, v_new_offset),
         template_data = CASE
           WHEN p_template_data IS NOT NULL AND p_template_data <> '{}'::jsonb
             THEN p_template_data
           ELSE template_data
         END
   WHERE queue = p_queue AND scheduler_id = p_scheduler_id;

  v_seq := nextval('bullmq_job_seq');
  v_state := CASE WHEN v_delay > 0 THEN 'delayed' ELSE 'waiting' END;

  INSERT INTO bullmq_job (
    queue, id, seq, name, state, data, opts, priority, delay_ms, max_attempts,
    added_at_ms, process_at_ms, scheduler_id
  ) VALUES (
    p_queue, v_jobid, v_seq, v_name, v_state,
    COALESCE(NULLIF(v_data, '{}'::jsonb), p_template_data, '{}'::jsonb),
    COALESCE(p_delayed_opts, '{}'::jsonb)
      || jsonb_build_object('delay', v_delay, 'jobId', v_jobid),
    COALESCE((p_delayed_opts ->> 'priority')::integer, 0), v_delay,
    COALESCE((p_delayed_opts ->> 'attempts')::integer, 1),
    COALESCE((p_delayed_opts ->> 'timestamp')::bigint, p_now),
    CASE WHEN v_delay > 0 THEN v_next ELSE NULL END, p_scheduler_id
  )
  ON CONFLICT (queue, id) DO NOTHING;

  PERFORM pg_notify('bullmq_jobs', p_queue);

  RETURN v_jobid;
END;
$$;

-- Remove a scheduler and its still-pending job, emitting a `removed` event for
-- each deleted job. Returns 0 if the scheduler existed (removed), 1 otherwise
-- (mirrors removeJobScheduler-3.lua: 0 = OK, 1 = missing).
CREATE FUNCTION bullmq_remove_job_scheduler(
  p_queue text, p_scheduler_id text
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_next    bigint;
  v_jobid   text;
  v_removed integer;
BEGIN
  -- Remove only the scheduler's *next* programmed job, and only while it is
  -- still delayed (mirrors removeJobScheduler-3.lua, which ZREMs the id
  -- `repeat:<id>:<next_run_ms>` from the delayed set). A job that has already
  -- been promoted (waiting/active/…) or processed survives — that surviving
  -- job is what later collides with a re-created scheduler to emit
  -- 'duplicated'. Deleting every delayed/waiting job of the scheduler would
  -- wrongly reap the promoted job.
  SELECT next_run_ms INTO v_next
    FROM bullmq_scheduler
   WHERE queue = p_queue AND scheduler_id = p_scheduler_id;

  IF v_next IS NOT NULL THEN
    v_jobid := 'repeat:' || p_scheduler_id || ':' || v_next;
    DELETE FROM bullmq_job
     WHERE queue = p_queue AND id = v_jobid AND state = 'delayed';
    IF FOUND THEN
      PERFORM bullmq_publish_event(p_queue, 'removed',
        jsonb_build_object('jobId', v_jobid, 'prev', 'delayed'));
    END IF;
  END IF;

  DELETE FROM bullmq_scheduler
   WHERE queue = p_queue AND scheduler_id = p_scheduler_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  RETURN CASE WHEN v_removed > 0 THEN 0 ELSE 1 END;
END;
$$;

-- Two-phase stalled detection (mirrors moveStalledJobsToWait-9.lua). A single
-- pass that reclaimed an active job the instant its lock expired was unsafe
-- under a fast-forwarding clock (repeatable-job tests tick the fake clock by a
-- month inside the processor): a freshly-claimed job's short lock looks expired
-- immediately, so the checker would yank the in-flight job back to wait and its
-- completion would then fail with "not in the active state". Instead:
--   * A `stalled-check` throttle bounds how often the scan runs.
--   * Jobs are *marked* (`stalled_marked`, the Redis `stalled` SET analogue) on
--     one pass and only *reclaimed* on the next if still active with an expired
--     lock — so a job that completes or renews its lock between passes is never
--     reclaimed.
--   * Scheduler ("repeatable") jobs are recovered but never permanently failed.
CREATE FUNCTION bullmq_move_stalled_jobs_to_wait(
  p_queue          text,
  p_max_stalled    integer,
  p_now            bigint,
  p_max_check_time bigint
) RETURNS SETOF text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_last       bigint;
  r            record;
  v_count      integer;
  v_repeatable boolean;
  v_reclaimed  boolean := false;
BEGIN
  -- Throttle: only run once per `max_check_time` window (mirrors the Redis
  -- `stalled-check` key with `PX maxCheckTime`).
  SELECT value::bigint INTO v_last
    FROM bullmq_meta WHERE queue = p_queue AND field = 'stalled-check';
  IF v_last IS NOT NULL AND p_now < v_last + p_max_check_time THEN
    RETURN;
  END IF;
  INSERT INTO bullmq_meta (queue, field, value)
    VALUES (p_queue, 'stalled-check', p_now::text)
    ON CONFLICT (queue, field) DO UPDATE SET value = EXCLUDED.value;

  -- Phase 1 (sweep): reclaim jobs that were marked on a PREVIOUS pass and are
  -- still active with an expired lock.
  FOR r IN
    SELECT id, scheduler_id, stalled_count
      FROM bullmq_job
     WHERE queue = p_queue
       AND state = 'active'
       AND stalled_marked
       AND locked_until_ms IS NOT NULL
       AND locked_until_ms < p_now
     FOR UPDATE SKIP LOCKED
  LOOP
    v_count := r.stalled_count + 1;

    -- Scheduler jobs are recovered but never permanently failed.
    v_repeatable := r.scheduler_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM bullmq_scheduler
       WHERE queue = p_queue AND scheduler_id = r.scheduler_id
    );

    UPDATE bullmq_job
       SET state = 'waiting',
           lock_token = NULL,
           locked_until_ms = NULL,
           stalled_marked = false,
           stalled_count = v_count,
           seq = nextval('bullmq_job_seq'),
           deferred_failure = CASE
             WHEN v_count > p_max_stalled AND NOT v_repeatable
               THEN 'job stalled more than allowable limit'
             ELSE deferred_failure
           END
     WHERE queue = p_queue AND id = r.id;

    PERFORM bullmq_publish_event(p_queue, 'stalled',
      jsonb_build_object('jobId', r.id));
    v_reclaimed := true;
    RETURN NEXT r.id;
  END LOOP;

  -- Clear all old marks (mirrors `DEL stalledKey`) …
  UPDATE bullmq_job SET stalled_marked = false
   WHERE queue = p_queue AND stalled_marked;

  -- … then mark every currently-active job for the NEXT pass (mirrors
  -- `SADD stalledKey <active>`). Freshly-claimed jobs are therefore never
  -- reclaimed on the pass that first observes them.
  UPDATE bullmq_job SET stalled_marked = true
   WHERE queue = p_queue AND state = 'active';

  -- Wake a worker for any jobs pushed back to wait.
  IF v_reclaimed THEN
    PERFORM pg_notify('bullmq_jobs', p_queue);
  END IF;
  RETURN;
END;
$$;

-- BullMQ PostgreSQL backend — rate limiting (schema v25).
--
-- Mirrors the Redis limiter, which is a single `<prefix>:<queue>:limiter`
-- counter key with a PTTL: a token is consumed (INCR + PEXPIRE-on-first) each
-- time a job is moved to active, and `getRateLimitTTL` reports the remaining
-- window once the counter reaches `max`. Here that key is one row of
-- `bullmq_rate_limit` (`points` ⇔ the counter, `expire_at_ms` ⇔ the PTTL
-- window). The limiter config comes from the queue meta (`max`/`duration`, set
-- via `Queue.setGlobalRateLimit`) and/or the worker's `limiter` option.

-- ── Public TTL (mirrors getRateLimitTtl-2.lua) ─────────────────────────────
-- p_max_jobs > 0 → check against that; else fall back to meta `max`; else the
-- raw remaining window (or -2 when there is none, like Redis PTTL on a missing
-- key).
CREATE FUNCTION bullmq_rate_limit_ttl(
  p_queue text, p_max_jobs integer, p_now bigint
) RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path FROM CURRENT
AS $$
DECLARE
  v_points  bigint;
  v_expire  bigint;
  v_active  boolean;
  v_counter bigint;
  v_pttl    bigint;
  v_max     integer;
BEGIN
  SELECT points, expire_at_ms INTO v_points, v_expire
    FROM bullmq_rate_limit WHERE queue = p_queue;
  v_active  := v_expire IS NOT NULL AND v_expire > p_now;
  v_counter := CASE WHEN v_active THEN v_points ELSE 0 END;
  v_pttl    := CASE WHEN v_active THEN v_expire - p_now ELSE -2 END;

  IF p_max_jobs IS NOT NULL AND p_max_jobs > 0 THEN
    IF p_max_jobs <= v_counter AND v_pttl > 0 THEN
      RETURN v_pttl;
    END IF;
    RETURN 0;
  END IF;

  SELECT value::integer INTO v_max
    FROM bullmq_meta WHERE queue = p_queue AND field = 'max';
  IF v_max IS NOT NULL THEN
    IF v_max <= v_counter AND v_pttl > 0 THEN
      RETURN v_pttl;
    END IF;
    RETURN 0;
  END IF;

  RETURN v_pttl;
END;
$$;

-- ── Worker-effective TTL ───────────────────────────────────────────────────
-- The limit that applies to a fetching worker: meta `max` takes precedence,
-- falling back to the worker's own `limiter.max`. Returns the remaining window
-- when the counter has reached that limit, else 0 (and 0 when no limiter at
-- all is configured).
CREATE FUNCTION bullmq_rate_limit_effective(
  p_queue text, p_limiter_max integer, p_now bigint
) RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path FROM CURRENT
AS $$
DECLARE
  v_meta_max integer;
  v_max      integer;
  v_points   bigint;
  v_expire   bigint;
BEGIN
  SELECT value::integer INTO v_meta_max
    FROM bullmq_meta WHERE queue = p_queue AND field = 'max';
  v_max := COALESCE(v_meta_max, p_limiter_max);
  IF v_max IS NULL THEN
    RETURN 0;
  END IF;

  SELECT points, expire_at_ms INTO v_points, v_expire
    FROM bullmq_rate_limit WHERE queue = p_queue;
  IF v_expire IS NULL OR v_expire <= p_now THEN
    RETURN 0;
  END IF;
  IF v_max <= v_points THEN
    RETURN v_expire - p_now;
  END IF;
  RETURN 0;
END;
$$;

-- Consume one token (INCR + PEXPIRE-on-first-of-window).
CREATE FUNCTION bullmq_rate_limit_consume(
  p_queue text, p_duration bigint, p_now bigint
) RETURNS void
LANGUAGE sql
SET search_path FROM CURRENT
AS $$
  INSERT INTO bullmq_rate_limit (queue, points, expire_at_ms)
    VALUES (p_queue, 1, p_now + p_duration)
  ON CONFLICT (queue) DO UPDATE SET
    points = CASE WHEN bullmq_rate_limit.expire_at_ms <= p_now
                  THEN 1 ELSE bullmq_rate_limit.points + 1 END,
    expire_at_ms = CASE WHEN bullmq_rate_limit.expire_at_ms <= p_now
                        THEN p_now + p_duration
                        ELSE bullmq_rate_limit.expire_at_ms END;
$$;

-- Force the limiter for `p_expire_ms` (dynamic / manual rate limit). Mirrors
-- Redis SET limiter = MAX_SAFE_INTEGER PX p_expire_ms.
CREATE FUNCTION bullmq_set_rate_limit(
  p_queue text, p_expire_ms bigint, p_now bigint
) RETURNS void
LANGUAGE sql
SET search_path FROM CURRENT
AS $$
  INSERT INTO bullmq_rate_limit (queue, points, expire_at_ms)
    VALUES (p_queue, 9007199254740991, p_now + p_expire_ms)
  ON CONFLICT (queue) DO UPDATE SET
    points = 9007199254740991,
    expire_at_ms = p_now + p_expire_ms;
$$;

-- The "no job" signal: the worker-effective rate-limit ttl and the next delayed
-- job's timestamp, in one round trip.
CREATE FUNCTION bullmq_next_signal(
  p_queue text, p_limiter_max integer, p_now bigint
) RETURNS TABLE (rate_limit_ttl bigint, next_delay bigint)
LANGUAGE sql
STABLE
SET search_path FROM CURRENT
AS $$
  SELECT bullmq_rate_limit_effective(p_queue, p_limiter_max, p_now),
         bullmq_next_delay(p_queue);
$$;

-- BullMQ PostgreSQL backend — obliterate (schema v27).
--
-- Completely destroys a queue and all of its contents, mirroring
-- obliterate-2.lua:
--   * The queue must be paused, else return -1.
--   * If there are active jobs and `force` is not set, return -2.
--   * Otherwise delete up to `p_count` jobs; return 1 while more remain (the
--     caller loops), and once every job is gone delete the remaining
--     per-queue data and return 0.
--
-- `bullmq_job_log` and `bullmq_job_dependency` rows cascade from `bullmq_job`,
-- so deleting the jobs removes their logs and (parent-side) dependency links.
CREATE FUNCTION bullmq_obliterate(
  p_queue text, p_count integer, p_force boolean
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM bullmq_meta
     WHERE queue = p_queue AND field = 'paused' AND value = '1'
  ) THEN
    RETURN -1;  -- NotPaused
  END IF;

  IF NOT p_force AND EXISTS (
    SELECT 1 FROM bullmq_job WHERE queue = p_queue AND state = 'active'
  ) THEN
    RETURN -2;  -- ExistActiveJobs
  END IF;

  WITH batch AS (
    SELECT id FROM bullmq_job WHERE queue = p_queue LIMIT p_count
  )
  DELETE FROM bullmq_job j
   USING batch
   WHERE j.queue = p_queue AND j.id = batch.id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- More jobs than the batch budget: tell the caller to come back.
  IF v_deleted >= p_count THEN
    RETURN 1;
  END IF;

  -- Every job is gone; remove the rest of the queue's footprint.
  DELETE FROM bullmq_scheduler  WHERE queue = p_queue;
  DELETE FROM bullmq_rate_limit WHERE queue = p_queue;
  DELETE FROM bullmq_event      WHERE queue = p_queue;
  DELETE FROM bullmq_metrics    WHERE queue = p_queue;
  DELETE FROM bullmq_dedup      WHERE queue = p_queue;
  DELETE FROM bullmq_dedup_next WHERE queue = p_queue;
  DELETE FROM bullmq_meta       WHERE queue = p_queue;
  -- Drop the per-queue job-id sequence so a re-created queue restarts at 1
  -- (mirrors Redis obliterate deleting the `<queue>:id` counter key).
  EXECUTE format(
    'DROP SEQUENCE IF EXISTS %I', bullmq_job_id_seq_name(p_queue));
  RETURN 0;
END;
$$;

-- BullMQ PostgreSQL backend — deduplication / debounce (schema version 28).
--
-- Mirrors the Redis deduplicateJob include chain. A job added with a
-- `deduplication` (or legacy `debounce`) option carries a `de` opts object
-- `{ id, ttl, extend, replace, keepLastIfActive }`. When a *live* key already
-- exists for that id the new job is NOT added: the existing "winner" job id is
-- returned and `deduplicated` events are emitted. The key is one
-- row of `bullmq_dedup` (`job_id` ⇔ the winner, `expire_at_ms` ⇔ the Redis
-- PTTL window; NULL = no expiry). The full key lifecycle:
--   * add        — set / check the key (see bullmq_deduplicate_job),
--   * finalize   — when the winner completes/fails, a no-ttl key is cleared
--                  (bullmq_dedup_finalize),
--   * removal    — when the winner is removed, its key is cleared
--                  (bullmq_dedup_on_removal).
-- NOTE: `keepLastIfActive`'s proto-job storage/requeue is added in a later
-- migration; here keepLastIfActive only governs the key's expiry (no ttl).

-- ── Finalize: clear a no-ttl key whose winner is finishing (PTTL == -1 path),
--    and reap an already-expired key (PTTL == 0). ttl keys expire on their own.
CREATE FUNCTION bullmq_dedup_finalize(
  p_queue text, p_dedup_id text, p_job_id text, p_now bigint
) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_cur text;
  v_exp bigint;
BEGIN
  IF p_dedup_id IS NULL OR p_dedup_id = '' THEN
    RETURN;
  END IF;
  SELECT job_id, expire_at_ms INTO v_cur, v_exp
    FROM bullmq_dedup WHERE queue = p_queue AND dedup_id = p_dedup_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  IF v_exp IS NULL THEN
    -- No expiry: only the current winner clears its own key.
    IF v_cur = p_job_id THEN
      DELETE FROM bullmq_dedup WHERE queue = p_queue AND dedup_id = p_dedup_id;
    END IF;
  ELSIF v_exp <= p_now THEN
    -- Already expired: reap it.
    DELETE FROM bullmq_dedup WHERE queue = p_queue AND dedup_id = p_dedup_id;
  END IF;
END;
$$;

-- ── Removal: clear the key (and any proto-next data) when its winner job is
--    removed (mirrors removeDeduplicationKeyIfNeededOnRemoval).
CREATE FUNCTION bullmq_dedup_on_removal(
  p_queue text, p_job_id text, p_dedup_id text
) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF p_dedup_id IS NULL OR p_dedup_id = '' THEN
    RETURN;
  END IF;
  DELETE FROM bullmq_dedup
   WHERE queue = p_queue AND dedup_id = p_dedup_id AND job_id = p_job_id;
END;
$$;

-- Stash the new job as the proto-next IF keepLastIfActive and the current
-- winner is active. Returns true when stashed. Mirrors storeDeduplicatedNextJob.
CREATE FUNCTION bullmq_dedup_store_next(
  p_queue text, p_dedup_id text, p_winner text, p_job_id text,
  p_keeplast boolean, p_name text, p_data jsonb, p_opts jsonb
) RETURNS boolean
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  IF NOT p_keeplast OR p_winner IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM bullmq_job
     WHERE queue = p_queue AND id = p_winner AND state = 'active'
  ) THEN
    RETURN false;
  END IF;
  INSERT INTO bullmq_dedup_next (queue, dedup_id, payload)
    VALUES (p_queue, p_dedup_id, jsonb_build_object(
      'name', p_name, 'data', p_data, 'opts', p_opts, 'jobId', p_job_id))
  ON CONFLICT (queue, dedup_id) DO UPDATE SET payload = EXCLUDED.payload;
  -- Persist the dedup key so it outlives the active job's duration.
  UPDATE bullmq_dedup SET expire_at_ms = NULL
   WHERE queue = p_queue AND dedup_id = p_dedup_id;
  RETURN true;
END;
$$;

-- Turn a stored proto-next into a real job (the new winner) when the active
-- winner finishes. Mirrors requeueDeduplicatedJob.
CREATE FUNCTION bullmq_requeue_dedup_next(
  p_queue text, p_dedup_id text, p_now bigint
) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_payload  jsonb;
  v_name     text;
  v_data     jsonb;
  v_opts     jsonb;
  v_job_id   text;
  v_de       jsonb;
  v_delay    bigint;
  v_priority integer;
  v_lifo     boolean;
  v_keeplast boolean;
  v_ttl      bigint;
  v_seq      bigint;
  v_state    bullmq_job_state;
  v_process_at bigint;
BEGIN
  IF p_dedup_id IS NULL OR p_dedup_id = '' THEN
    RETURN;
  END IF;
  SELECT payload INTO v_payload
    FROM bullmq_dedup_next WHERE queue = p_queue AND dedup_id = p_dedup_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_name   := v_payload->>'name';
  v_data   := COALESCE(v_payload->'data', '{}'::jsonb);
  v_opts   := COALESCE(v_payload->'opts', '{}'::jsonb);
  v_job_id := v_payload->>'jobId';
  IF v_job_id IS NULL OR v_job_id = '' THEN
    v_job_id := bullmq_next_job_id(p_queue);
  END IF;

  v_de       := COALESCE(v_opts->'deduplication', v_opts->'debounce');
  v_delay    := COALESCE((v_opts->>'delay')::bigint, 0);
  v_priority := COALESCE((v_opts->>'priority')::integer, 0);
  v_lifo     := COALESCE((v_opts->>'lifo')::boolean, false);
  v_keeplast := COALESCE((v_de->>'keepLastIfActive')::boolean, false);
  v_ttl      := NULLIF(v_de->>'ttl', '')::bigint;

  v_seq := nextval('bullmq_job_seq');
  IF v_lifo THEN
    v_seq := -v_seq;
  END IF;
  IF v_delay > 0 THEN
    v_state := 'delayed';
    v_process_at := p_now + v_delay;
  ELSE
    v_state := 'waiting';
    v_process_at := NULL;
  END IF;

  INSERT INTO bullmq_job (
    queue, id, seq, name, state, data, opts, priority, delay_ms,
    max_attempts, added_at_ms, process_at_ms, dedup_id
  ) VALUES (
    p_queue, v_job_id, v_seq, v_name, v_state, v_data, v_opts, v_priority,
    v_delay, COALESCE((v_opts->>'attempts')::integer, 1), p_now, v_process_at,
    p_dedup_id
  )
  ON CONFLICT (queue, id) DO NOTHING;

  -- New winner key (no expiry while keepLastIfActive, else honour ttl).
  INSERT INTO bullmq_dedup (queue, dedup_id, job_id, expire_at_ms)
    VALUES (p_queue, p_dedup_id, v_job_id,
      CASE WHEN v_keeplast OR COALESCE(v_ttl, 0) <= 0
           THEN NULL ELSE p_now + v_ttl END)
  ON CONFLICT (queue, dedup_id) DO UPDATE
    SET job_id = EXCLUDED.job_id, expire_at_ms = EXCLUDED.expire_at_ms;

  DELETE FROM bullmq_dedup_next WHERE queue = p_queue AND dedup_id = p_dedup_id;

  PERFORM pg_notify('bullmq_jobs', p_queue);
  IF v_state = 'delayed' THEN
    PERFORM bullmq_publish_event(p_queue, 'delayed',
      jsonb_build_object('jobId', v_job_id, 'delay', v_process_at));
  ELSE
    PERFORM bullmq_publish_event(p_queue, 'waiting',
      jsonb_build_object('jobId', v_job_id));
  END IF;
END;
$$;

-- ── Core decision (mirrors deduplicateJob / deduplicateJobWithoutReplace).
-- Returns the existing winner's id when the new job should be deduplicated
-- (i.e. NOT inserted); returns NULL when the caller should go on to add it.
CREATE FUNCTION bullmq_deduplicate_job(
  p_queue text, p_dedup jsonb, p_job_id text, p_now bigint,
  p_name text, p_data jsonb, p_opts jsonb
) RETURNS text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_id       text    := p_dedup->>'id';
  v_ttl      bigint  := NULLIF(p_dedup->>'ttl', '')::bigint;
  v_extend   boolean := COALESCE((p_dedup->>'extend')::boolean, false);
  v_replace  boolean := COALESCE((p_dedup->>'replace')::boolean, false);
  v_keeplast boolean := COALESCE((p_dedup->>'keepLastIfActive')::boolean, false);
  v_cur      text;
  v_exp      bigint;
  v_state    bullmq_job_state;
BEGIN
  IF v_id IS NULL OR v_id = '' THEN
    RETURN NULL;
  END IF;

  -- The current winner (only if the key is still live).
  SELECT job_id, expire_at_ms INTO v_cur, v_exp
    FROM bullmq_dedup WHERE queue = p_queue AND dedup_id = v_id;
  IF v_cur IS NULL OR (v_exp IS NOT NULL AND v_exp <= p_now) THEN
    v_cur := NULL;
  END IF;

  IF v_replace THEN
    IF v_cur IS NOT NULL THEN
      SELECT state INTO v_state
        FROM bullmq_job WHERE queue = p_queue AND id = v_cur;
      IF v_state = 'delayed' THEN
        -- Drop the previous delayed job and take its place.
        DELETE FROM bullmq_job WHERE queue = p_queue AND id = v_cur;
        PERFORM bullmq_publish_event(p_queue, 'removed',
          jsonb_build_object('jobId', v_cur, 'prev', 'delayed'));
        PERFORM bullmq_publish_event(p_queue, 'deduplicated',
          jsonb_build_object('jobId', p_job_id, 'deduplicationId', v_id,
            'deduplicatedJobId', v_cur));
        IF v_keeplast THEN
          UPDATE bullmq_dedup SET job_id = p_job_id, expire_at_ms = NULL
           WHERE queue = p_queue AND dedup_id = v_id;
        ELSIF NOT v_extend AND COALESCE(v_ttl, 0) > 0 THEN
          -- KEEPTTL: keep the existing window, just swap the winner.
          UPDATE bullmq_dedup SET job_id = p_job_id
           WHERE queue = p_queue AND dedup_id = v_id;
        ELSE
          UPDATE bullmq_dedup
             SET job_id = p_job_id,
                 expire_at_ms = CASE WHEN COALESCE(v_ttl, 0) > 0
                                     THEN p_now + v_ttl ELSE NULL END
           WHERE queue = p_queue AND dedup_id = v_id;
        END IF;
        RETURN NULL;
      ELSE
        -- Winner is not a removable delayed job: stash proto-next if it is
        -- active + keepLastIfActive, then deduplicate.
        PERFORM bullmq_dedup_store_next(p_queue, v_id, v_cur, p_job_id,
          v_keeplast, p_name, p_data, p_opts);
        RETURN v_cur;
      END IF;
    ELSE
      INSERT INTO bullmq_dedup (queue, dedup_id, job_id, expire_at_ms)
        VALUES (p_queue, v_id, p_job_id,
          CASE WHEN NOT v_keeplast AND COALESCE(v_ttl, 0) > 0
               THEN p_now + v_ttl ELSE NULL END)
      ON CONFLICT (queue, dedup_id) DO UPDATE
        SET job_id = EXCLUDED.job_id, expire_at_ms = EXCLUDED.expire_at_ms;
      RETURN NULL;
    END IF;
  END IF;

  -- Without replace.
  IF COALESCE(v_ttl, 0) > 0 AND v_extend THEN
    IF v_cur IS NOT NULL THEN
      -- Stash proto-next if active+keepLast; else extend the window (or
      -- persist when keepLastIfActive). Either way keep the current winner.
      IF NOT bullmq_dedup_store_next(p_queue, v_id, v_cur, p_job_id,
               v_keeplast, p_name, p_data, p_opts) THEN
        UPDATE bullmq_dedup
           SET expire_at_ms = CASE WHEN v_keeplast THEN NULL ELSE p_now + v_ttl END
         WHERE queue = p_queue AND dedup_id = v_id;
      END IF;
      PERFORM bullmq_publish_event(p_queue, 'deduplicated',
        jsonb_build_object('jobId', v_cur, 'deduplicationId', v_id,
          'deduplicatedJobId', p_job_id));
      RETURN v_cur;
    END IF;
    INSERT INTO bullmq_dedup (queue, dedup_id, job_id, expire_at_ms)
      VALUES (p_queue, v_id, p_job_id,
        CASE WHEN v_keeplast THEN NULL ELSE p_now + v_ttl END)
    ON CONFLICT (queue, dedup_id) DO UPDATE
      SET job_id = EXCLUDED.job_id, expire_at_ms = EXCLUDED.expire_at_ms;
    RETURN NULL;
  END IF;

  -- SET NX semantics (ttl>0 non-extend, or no ttl at all).
  IF v_cur IS NOT NULL THEN
    PERFORM bullmq_dedup_store_next(p_queue, v_id, v_cur, p_job_id,
      v_keeplast, p_name, p_data, p_opts);
    PERFORM bullmq_publish_event(p_queue, 'deduplicated',
      jsonb_build_object('jobId', v_cur, 'deduplicationId', v_id,
        'deduplicatedJobId', p_job_id));
    RETURN v_cur;
  END IF;

  INSERT INTO bullmq_dedup (queue, dedup_id, job_id, expire_at_ms)
    VALUES (p_queue, v_id, p_job_id,
      CASE WHEN NOT v_keeplast AND COALESCE(v_ttl, 0) > 0
           THEN p_now + v_ttl ELSE NULL END)
  ON CONFLICT (queue, dedup_id) DO UPDATE
    SET job_id = EXCLUDED.job_id, expire_at_ms = EXCLUDED.expire_at_ms;
  RETURN NULL;
END;
$$;

-- BullMQ PostgreSQL backend — flow failure propagation (schema version 29).
--
-- When a child job fails permanently, its parent must react according to the
-- child's parent-link options (mirrors moveChildFromDependenciesIfNeeded):
--   * failParentOnFailure (fpof)      → record the child as a failed dependency,
--                                        defer a failure onto the parent and (if
--                                        it is waiting on children) release it so
--                                        a worker picks it up and fails it.
--   * continueParentOnFailure (cpof)  → record the child as an ignored
--                                        dependency and release the parent.
--   * ignoreDependencyOnFailure (idof)→ record the child as ignored and release
--                                        the parent once no pending deps remain.
--   * removeDependencyOnFailure (rdof)→ drop the dependency entirely and release
--                                        the parent once no pending deps remain.
-- The PG backend stores raw JobsOptions, so the long option names are read
-- straight from the child's `opts`.

-- Release a parent from waiting-children to wait (mirrors moveParentToWait —
-- priority is preserved by the row's `priority` column; FIFO order via a fresh
-- seq). Emits the 'waiting' (prev waiting-children) event and wakes a worker.
CREATE FUNCTION bullmq_move_parent_to_wait(
  p_parent_queue text, p_parent_id text, p_now bigint
) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_delay      bigint;
  v_process_at bigint;
BEGIN
  SELECT delay_ms INTO v_delay
    FROM bullmq_job
   WHERE queue = p_parent_queue AND id = p_parent_id
     AND state = 'waiting-children';
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_delay > 0 THEN
    -- The parent carries a delay: release it into the delayed set (mirrors the
    -- delay branch of moveParentToWait), scored from the release moment.
    v_process_at := p_now + v_delay;
    UPDATE bullmq_job
       SET state = 'delayed', process_at_ms = v_process_at,
           seq = nextval('bullmq_job_seq')
     WHERE queue = p_parent_queue AND id = p_parent_id;
    PERFORM pg_notify('bullmq_jobs', p_parent_queue);
    PERFORM bullmq_publish_event(p_parent_queue, 'delayed',
      jsonb_build_object('jobId', p_parent_id, 'delay', v_process_at));
  ELSE
    -- No delay: release to wait. Priority is preserved by the row's `priority`
    -- column, so a prioritized parent stays prioritized.
    UPDATE bullmq_job
       SET state = 'waiting', seq = nextval('bullmq_job_seq')
     WHERE queue = p_parent_queue AND id = p_parent_id;
    PERFORM pg_notify('bullmq_jobs', p_parent_queue);
    PERFORM bullmq_publish_event(p_parent_queue, 'waiting',
      jsonb_build_object('jobId', p_parent_id, 'prev', 'waiting-children'));
  END IF;
END;
$$;

-- Propagate a child's permanent failure to its parent.
CREATE FUNCTION bullmq_handle_child_failure(
  p_queue text, p_id text, p_reason text, p_now bigint
) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_pq        text;
  v_pid       text;
  v_opts      jsonb;
  v_child_key text;
  v_remaining integer;
BEGIN
  SELECT parent_queue, parent_id, opts INTO v_pq, v_pid, v_opts
    FROM bullmq_job WHERE queue = p_queue AND id = p_id;
  IF v_pid IS NULL OR v_pq IS NULL THEN
    RETURN;
  END IF;
  v_child_key := p_queue || ':' || p_id;

  -- Serialize this child→parent mutation with any sibling resolving concurrently
  -- (completion or failure). Mirrors the single-threaded atomicity Redis relies
  -- on and prevents the `pending_deps` UPDATE from deadlocking against a
  -- sibling's decrement (SQLSTATE 40P01). Taken on the direct parent only, so it
  -- never nests and auto-releases at commit (see bullmq_move_to_completed).
  PERFORM pg_advisory_xact_lock(
    hashtext('bullmq:parent:' || v_pq || ':' || v_pid));

  IF COALESCE((v_opts->>'failParentOnFailure')::boolean, false) THEN
    UPDATE bullmq_job_dependency
       SET status = 'failed', value = to_jsonb(p_reason)
     WHERE parent_queue = v_pq AND parent_id = v_pid
       AND child_key = v_child_key AND status = 'pending';
    IF FOUND THEN
      UPDATE bullmq_job SET pending_deps = GREATEST(pending_deps - 1, 0)
       WHERE queue = v_pq AND id = v_pid;
      -- Defer the failure onto the parent; when a worker activates it the
      -- deferred failure fails it immediately (worker checks job.deferredFailure).
      UPDATE bullmq_job
         SET deferred_failure = 'child ' || v_child_key || ' failed'
       WHERE queue = v_pq AND id = v_pid;
      PERFORM bullmq_move_parent_to_wait(v_pq, v_pid, p_now);
    END IF;

  ELSIF COALESCE((v_opts->>'continueParentOnFailure')::boolean, false) THEN
    UPDATE bullmq_job_dependency
       SET status = 'ignored', value = to_jsonb(p_reason)
     WHERE parent_queue = v_pq AND parent_id = v_pid
       AND child_key = v_child_key AND status = 'pending';
    IF FOUND THEN
      UPDATE bullmq_job SET pending_deps = GREATEST(pending_deps - 1, 0)
       WHERE queue = v_pq AND id = v_pid;
      PERFORM bullmq_move_parent_to_wait(v_pq, v_pid, p_now);
    END IF;

  ELSIF COALESCE((v_opts->>'ignoreDependencyOnFailure')::boolean, false) THEN
    UPDATE bullmq_job_dependency
       SET status = 'ignored', value = to_jsonb(p_reason)
     WHERE parent_queue = v_pq AND parent_id = v_pid
       AND child_key = v_child_key AND status = 'pending';
    IF FOUND THEN
      UPDATE bullmq_job SET pending_deps = GREATEST(pending_deps - 1, 0)
       WHERE queue = v_pq AND id = v_pid
      RETURNING pending_deps INTO v_remaining;
      IF v_remaining = 0 THEN
        PERFORM bullmq_move_parent_to_wait(v_pq, v_pid, p_now);
      END IF;
    END IF;

  ELSIF COALESCE((v_opts->>'removeDependencyOnFailure')::boolean, false) THEN
    DELETE FROM bullmq_job_dependency
     WHERE parent_queue = v_pq AND parent_id = v_pid
       AND child_key = v_child_key AND status = 'pending';
    IF FOUND THEN
      UPDATE bullmq_job SET pending_deps = GREATEST(pending_deps - 1, 0)
       WHERE queue = v_pq AND id = v_pid
      RETURNING pending_deps INTO v_remaining;
      IF v_remaining = 0 THEN
        PERFORM bullmq_move_parent_to_wait(v_pq, v_pid, p_now);
      END IF;
    END IF;
  END IF;
END;
$$;

-- ── removeChildDependency: break a child's link to its parent (mirrors
--    removeChildDependency-1.lua). Returns 0 when the relationship existed and
--    was removed, 1 when there was no relationship; raises -1 (missing job) /
--    -5 (missing parent).
CREATE FUNCTION bullmq_remove_child_dependency(
  p_queue text, p_id text, p_parent_key text, p_now bigint
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_pq        text;
  v_pid       text;
  v_deleted   integer;
  v_remaining integer;
BEGIN
  SELECT parent_queue, parent_id INTO v_pq, v_pid
    FROM bullmq_job WHERE queue = p_queue AND id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bullmq: missing job %', p_id
      USING ERRCODE = 'BM001', DETAIL = '-1';
  END IF;
  IF v_pq IS NULL OR v_pid IS NULL THEN
    RETURN 1; -- no relationship
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM bullmq_job WHERE queue = v_pq AND id = v_pid
  ) THEN
    RAISE EXCEPTION 'bullmq: missing parent %', p_parent_key
      USING ERRCODE = 'BM001', DETAIL = '-5';
  END IF;

  DELETE FROM bullmq_job_dependency
   WHERE parent_queue = v_pq AND parent_id = v_pid
     AND child_key = p_queue || ':' || p_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RETURN 1;
  END IF;

  -- Detach the child and release the parent if it has no more pending deps.
  UPDATE bullmq_job
     SET parent_queue = NULL, parent_id = NULL, parent_key = NULL
   WHERE queue = p_queue AND id = p_id;
  -- Serialize with concurrent child resolutions of the same parent (see
  -- bullmq_move_to_completed) to avoid a pending_deps deadlock.
  PERFORM pg_advisory_xact_lock(
    hashtext('bullmq:parent:' || v_pq || ':' || v_pid));
  UPDATE bullmq_job SET pending_deps = GREATEST(pending_deps - 1, 0)
   WHERE queue = v_pq AND id = v_pid
  RETURNING pending_deps INTO v_remaining;
  IF v_remaining = 0 THEN
    PERFORM bullmq_move_parent_to_wait(v_pq, v_pid, p_now);
  END IF;
  RETURN 0;
END;
$$;

-- ── removeUnprocessedChildren: recursively remove a parent's still-pending
--    children (skipping active/locked ones), mirroring removeUnprocessedChildren-2.
--    Emits 'removed' for each child taken out; cascades clean up dependency rows.
CREATE FUNCTION bullmq_remove_unprocessed_children(
  p_queue text, p_id text
) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    WITH RECURSIVE subtree AS (
      SELECT j.queue AS q, j.id AS id
        FROM bullmq_job_dependency d
        JOIN bullmq_job j ON j.queue = d.child_queue AND j.id = d.child_id
       WHERE d.parent_queue = p_queue AND d.parent_id = p_id
         AND d.status = 'pending'
         AND j.state NOT IN ('active', 'failed', 'completed')
         AND j.lock_token IS NULL
      UNION
      SELECT j.queue, j.id
        FROM subtree s
        JOIN bullmq_job_dependency d
          ON d.parent_queue = s.q AND d.parent_id = s.id AND d.status = 'pending'
        JOIN bullmq_job j ON j.queue = d.child_queue AND j.id = d.child_id
       WHERE j.state NOT IN ('active', 'failed', 'completed')
         AND j.lock_token IS NULL
    )
    SELECT q, id FROM subtree
  LOOP
    -- Decrement the (live) parent's pending counter for direct children.
    UPDATE bullmq_job p SET pending_deps = GREATEST(pending_deps - 1, 0)
      FROM bullmq_job_dependency d
     WHERE d.child_queue = r.q AND d.child_id = r.id AND d.status = 'pending'
       AND p.queue = d.parent_queue AND p.id = d.parent_id;
    DELETE FROM bullmq_job WHERE queue = r.q AND id = r.id;
    PERFORM bullmq_publish_event(r.q, 'removed',
      jsonb_build_object('jobId', r.id, 'prev', 'waiting'));
  END LOOP;
END;
$$;

-- BullMQ PostgreSQL backend — duplicated flow jobs (schema version 30).
--
-- When a flow (or a plain add with a parent) references a job id that already
-- exists, BullMQ does not insert a second job; instead it re-attaches the
-- existing job to the new parent (mirrors handleDuplicatedJob +
-- updateExistingJobsParent):
--   * if the existing job already has a *different* parent that still exists,
--     the parent cannot be replaced → ErrorCode -7;
--   * otherwise the existing job is linked to the new parent. A still-pending
--     job becomes a pending dependency (incrementing the parent's counter); an
--     already-completed job is recorded as a processed dependency (carrying its
--     return value) and, if it clears the parent's last pending dependency, the
--     parent is released.
CREATE FUNCTION bullmq_handle_duplicated_job(
  p_queue        text,
  p_id           text,
  p_parent_queue text,
  p_parent_id    text,
  p_parent_key   text,
  p_now          bigint
) RETURNS integer
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_ex_pq     text;
  v_ex_pid    text;
  v_state     bullmq_job_state;
  v_rv        jsonb;
  v_remaining integer;
  v_added     boolean;
BEGIN
  -- No new parent to attach: still a duplicate add, so announce it.
  IF p_parent_id IS NULL OR p_parent_queue IS NULL THEN
    PERFORM bullmq_publish_event(p_queue, 'duplicated',
      jsonb_build_object('jobId', p_id));
    RETURN 0;
  END IF;

  SELECT parent_queue, parent_id, state, return_value
    INTO v_ex_pq, v_ex_pid, v_state, v_rv
    FROM bullmq_job WHERE queue = p_queue AND id = p_id;

  -- The existing job already belongs to a different (still-existing) parent.
  IF v_ex_pq IS NOT NULL
     AND (v_ex_pq IS DISTINCT FROM p_parent_queue
          OR v_ex_pid IS DISTINCT FROM p_parent_id)
     AND EXISTS (
       SELECT 1 FROM bullmq_job WHERE queue = v_ex_pq AND id = v_ex_pid
     ) THEN
    RETURN -7;
  END IF;

  IF v_state = 'completed' THEN
    -- Already finished: record a processed dependency (no pending increment)
    -- and release the parent if this was its last outstanding dependency.
    INSERT INTO bullmq_job_dependency (
      parent_queue, parent_id, child_queue, child_id, child_key, status, value
    ) VALUES (
      p_parent_queue, p_parent_id, p_queue, p_id,
      p_queue || ':' || p_id, 'processed', v_rv
    )
    ON CONFLICT (parent_queue, parent_id, child_key)
      DO UPDATE SET status = 'processed', value = v_rv;

    SELECT pending_deps INTO v_remaining
      FROM bullmq_job WHERE queue = p_parent_queue AND id = p_parent_id;
    IF COALESCE(v_remaining, 0) = 0 THEN
      PERFORM bullmq_move_parent_to_wait(p_parent_queue, p_parent_id, p_now);
    END IF;
  ELSE
    -- Still pending: register a pending dependency and count it on the parent.
    INSERT INTO bullmq_job_dependency (
      parent_queue, parent_id, child_queue, child_id, child_key, status
    ) VALUES (
      p_parent_queue, p_parent_id, p_queue, p_id,
      p_queue || ':' || p_id, 'pending'
    )
    ON CONFLICT (parent_queue, parent_id, child_key) DO NOTHING;
    GET DIAGNOSTICS v_added = ROW_COUNT;
    IF v_added THEN
      UPDATE bullmq_job SET pending_deps = pending_deps + 1
       WHERE queue = p_parent_queue AND id = p_parent_id;
    END IF;
  END IF;

  -- Point the existing job at its new parent.
  UPDATE bullmq_job
     SET parent_queue = p_parent_queue,
         parent_id    = p_parent_id,
         parent_key   = p_parent_key
   WHERE queue = p_queue AND id = p_id;

  PERFORM bullmq_publish_event(p_queue, 'duplicated',
    jsonb_build_object('jobId', p_id));

  RETURN 0;
END;
$$;

-- Record one finished job into the queue/kind metrics (mirrors collectMetrics).
-- `p_max` is the worker's `metrics.maxDataPoints`; `p_ts` the finish timestamp.
CREATE FUNCTION bullmq_collect_metrics(
  p_queue text, p_kind text, p_max integer, p_ts bigint
) RETURNS void
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_count      bigint;
  v_prev_ts    bigint;
  v_prev_count bigint;
  v_data       bigint[];
  v_n          bigint;
  v_delta      bigint;
BEGIN
  -- Increment the cumulative count; v_count is the value BEFORE this job
  -- (matches Lua's `HINCRBY count 1) - 1`).
  INSERT INTO bullmq_metrics (queue, kind, count, prev_ts, prev_count, data)
    VALUES (p_queue, p_kind, 1, NULL, 0, '{}')
  ON CONFLICT (queue, kind) DO UPDATE SET count = bullmq_metrics.count + 1
  RETURNING count - 1, prev_ts, prev_count, data
    INTO v_count, v_prev_ts, v_prev_count, v_data;

  -- First data point only establishes the baseline.
  IF v_prev_ts IS NULL THEN
    UPDATE bullmq_metrics SET prev_ts = p_ts, prev_count = 0
     WHERE queue = p_queue AND kind = p_kind;
    RETURN;
  END IF;

  -- Number of one-minute buckets elapsed since the last data point, capped.
  v_n := LEAST(p_ts / 60000 - v_prev_ts / 60000, p_max);
  IF v_n > 0 THEN
    v_delta := v_count - v_prev_count;
    -- Prepend N-1 zeros for the skipped (empty) minutes, then the delta for the
    -- minute of the previous data point. Mirrors Redis collectMetrics, which
    -- LPUSHes the delta first and then the zeros, leaving the zeros newest and
    -- the delta oldest within this chunk (data is newest-first).
    IF v_n > 1 THEN
      v_data := array_fill(0::bigint, ARRAY[(v_n - 1)::int])
                || ARRAY[v_delta]
                || v_data;
    ELSE
      v_data := ARRAY[v_delta] || v_data;
    END IF;
    -- Trim to the max number of data points.
    v_data := v_data[1 : p_max];
    UPDATE bullmq_metrics
       SET data = v_data, prev_count = v_count, prev_ts = p_ts
     WHERE queue = p_queue AND kind = p_kind;
  END IF;
END;
$$;

-- BullMQ PostgreSQL backend — fused finish+fetch (schema version 32).
--
-- Redis's `moveToFinished` completes (or fails) the current job AND returns the
-- next job to process in a single round-trip / atomic script. The PostgreSQL
-- backend previously did this as two separate calls — `move_to_completed` (or
-- `move_to_failed`) followed by `move_to_active` — i.e. TWO transactions, hence
-- two commits and two WAL fsyncs per processed job. Processing is commit-bound
-- (each commit fsyncs the WAL under synchronous_commit=on), so paying two
-- commits per job roughly halves throughput versus one.
--
-- These wrappers fuse the two into a single function call — one transaction, one
-- commit — by simply invoking the existing, unchanged finish and claim functions
-- in sequence. No logic is duplicated: `bullmq_move_to_completed` /
-- `bullmq_move_to_failed` keep all their semantics (parent release, retention,
-- dedup, events, retries), and `bullmq_move_to_active` keeps all of its
-- (delayed promotion, pause/concurrency/limiter checks, FOR UPDATE SKIP LOCKED
-- claim). The finish runs first; if it raises (BM001 lock/state errors) the
-- whole transaction rolls back and nothing is claimed — matching the old
-- behaviour where a failed finish never fetched a next job. The next job is
-- locked with the same worker token the finish used, exactly as the standalone
-- `move_to_active` did.
--
-- The worker passes `fetchNext`; when false the backend still calls the plain
-- finish functions, so these wrappers are only used on the hot processing loop.

-- ──────────────────────────────────────────────────────────────────────────
-- complete + claim next (0 or 1 job rows)
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_move_to_completed_fetch(
  p_queue            text,
  p_id               text,
  p_token            text,
  p_return_value     jsonb,
  p_finished_on      bigint,
  p_remove_all       boolean,
  p_keep_age         bigint,
  p_keep_count       integer,
  p_lock_ms          bigint,
  p_now              bigint,
  p_name             text,
  p_limiter_max      integer,
  p_limiter_duration bigint
) RETURNS SETOF bullmq_job
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  PERFORM bullmq_move_to_completed(
    p_queue, p_id, p_token, p_return_value,
    p_finished_on, p_remove_all, p_keep_age, p_keep_count);

  RETURN QUERY SELECT * FROM bullmq_move_to_active(
    p_queue, p_token, p_lock_ms, p_now, p_name, p_limiter_max, p_limiter_duration);
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- fail (or retry) + claim next (0 or 1 job rows)
-- ──────────────────────────────────────────────────────────────────────────
CREATE FUNCTION bullmq_move_to_failed_fetch(
  p_queue            text,
  p_id               text,
  p_token            text,
  p_failed_reason    text,
  p_stacktrace       jsonb,
  p_finished_on      bigint,
  p_remove_all       boolean,
  p_keep_age         bigint,
  p_keep_count       integer,
  p_lock_ms          bigint,
  p_now              bigint,
  p_name             text,
  p_limiter_max      integer,
  p_limiter_duration bigint
) RETURNS SETOF bullmq_job
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
BEGIN
  PERFORM bullmq_move_to_failed(
    p_queue, p_id, p_token, p_failed_reason, p_stacktrace,
    p_finished_on, p_remove_all, p_keep_age, p_keep_count);

  RETURN QUERY SELECT * FROM bullmq_move_to_active(
    p_queue, p_token, p_lock_ms, p_now, p_name, p_limiter_max, p_limiter_duration);
END;
$$;

-- ──────────────────────────────────────────────────────────────────────────
-- add_jobs_bulk: fast set-based bulk insert for INDEPENDENT jobs (no parents,
-- no deduplication). This is the common Queue.add_bulk case. Unlike
-- bullmq_add_flow — which loops row-by-row to support flow trees, dedup and
-- mixed states — this inserts the whole batch with a single set-based INSERT
-- and emits the lifecycle events in one more set-based INSERT, so it is several
-- times faster. Returns the job ids in input order. Callers must route flows or
-- deduplicated jobs to bullmq_add_flow instead.
CREATE FUNCTION bullmq_add_jobs_bulk(p_queue text, p_entries jsonb)
RETURNS SETOF text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_seq_name text := bullmq_job_id_seq_name(p_queue);
BEGIN
  -- Ensure the per-queue id sequence exists (mirrors bullmq_next_job_id).
  IF to_regclass(v_seq_name) IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('bullmq:jidseq:' || p_queue));
    EXECUTE format('CREATE SEQUENCE IF NOT EXISTS %I', v_seq_name);
  END IF;

  CREATE TEMP TABLE _bulk_result ON COMMIT DROP AS
  WITH elems AS (
    SELECT value AS j, ord
      FROM jsonb_array_elements(p_entries) WITH ORDINALITY AS e(value, ord)
  ),
  prepared AS (
    SELECT
      ord,
      COALESCE(NULLIF(j->>'id', ''), nextval(v_seq_name::regclass)::text) AS id,
      j->>'name'                                        AS name,
      COALESCE((j->>'data')::jsonb, '{}'::jsonb)        AS data,
      COALESCE(j->'opts', '{}'::jsonb)                  AS opts,
      COALESCE((j->>'priority')::integer, 0)            AS priority,
      COALESCE((j->>'delay')::bigint, 0)                AS delay,
      COALESCE((j->>'timestamp')::bigint, 0)            AS ts,
      COALESCE((j->>'attempts')::integer, 1)            AS attempts,
      j->>'schedulerId'                                 AS scheduler_id,
      COALESCE((j->>'lifo')::boolean, false)            AS lifo
      FROM elems
  ),
  -- Reserve one global FIFO seq per row and pair the ord-th smallest reserved
  -- value with the ord-th entry, so seq is strictly monotonic in input order
  -- regardless of evaluation order.
  reserved AS (
    SELECT ord, nextval('bullmq_job_seq') AS s FROM prepared
  ),
  rr AS (SELECT s, row_number() OVER (ORDER BY s) AS rn FROM reserved),
  rp AS (SELECT prepared.*, row_number() OVER (ORDER BY ord) AS rn FROM prepared),
  final AS (
    SELECT rp.ord, rp.id, rp.name, rp.data, rp.opts, rp.priority, rp.delay,
           rp.ts, rp.attempts, rp.scheduler_id,
           CASE WHEN rp.lifo THEN -rr.s ELSE rr.s END AS seq,
           CASE WHEN rp.delay > 0 THEN 'delayed'::bullmq_job_state
                ELSE 'waiting'::bullmq_job_state END   AS state,
           CASE WHEN rp.delay > 0 THEN rp.ts + rp.delay ELSE NULL END AS process_at
      FROM rp JOIN rr ON rp.rn = rr.rn
  )
  SELECT * FROM final ORDER BY ord;

  -- Insert the batch, capturing ONLY the rows actually inserted: ON CONFLICT
  -- skips ids that already exist and in-batch duplicate ids. Events and the
  -- wakeup are driven from this set, so a batch that repeats or reuses an id
  -- does not emit spurious added/waiting/delayed events or a bogus NOTIFY —
  -- mirroring bullmq_add_flow's per-row `IF v_inserted` gating.
  CREATE TEMP TABLE _bulk_inserted ON COMMIT DROP AS
  WITH ins AS (
    INSERT INTO bullmq_job (
      queue, id, seq, name, state, data, opts, priority, delay_ms, max_attempts,
      added_at_ms, process_at_ms, scheduler_id, pending_deps
    )
    SELECT p_queue, id, seq, name, state, data, opts, priority, delay, attempts,
           ts, process_at, scheduler_id, 0
      FROM _bulk_result
    ON CONFLICT (queue, id) DO NOTHING
    RETURNING id, seq, name, state, process_at_ms
  )
  SELECT * FROM ins;

  -- One set-based event flush ('added' then the state event per inserted job),
  -- ordered by seq so the stream keeps FIFO order (mirrors bullmq_add_flow).
  INSERT INTO bullmq_event (queue, event, data, created_at_ms)
  SELECT p_queue, ev, dat, (extract(epoch FROM clock_timestamp()) * 1000)::bigint
    FROM (
      SELECT seq * 2       AS o, 'added' AS ev,
             jsonb_build_object('jobId', id, 'name', name) AS dat
        FROM _bulk_inserted
      UNION ALL
      SELECT seq * 2 + 1,
             CASE WHEN state = 'waiting' THEN 'waiting' ELSE 'delayed' END,
             CASE WHEN state = 'waiting'
                  THEN jsonb_build_object('jobId', id)
                  ELSE jsonb_build_object('jobId', id, 'delay', process_at_ms) END
        FROM _bulk_inserted
    ) q
   ORDER BY o;

  IF EXISTS (SELECT 1 FROM _bulk_inserted) THEN
    PERFORM pg_notify('bullmq_jobs', p_queue);
  END IF;

  RETURN QUERY SELECT id FROM _bulk_result ORDER BY ord;
END;
$$;
