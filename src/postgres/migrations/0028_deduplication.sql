-- BullMQ PostgreSQL backend — deduplication / debounce (schema version 28).
--
-- Mirrors the Redis deduplicateJob include chain. A job added with a
-- `deduplication` (or legacy `debounce`) option carries a `de` opts object
-- `{ id, ttl, extend, replace, keepLastIfActive }`. When a *live* key already
-- exists for that id the new job is NOT added: the existing "winner" job id is
-- returned and `debounced` + `deduplicated` events are emitted. The key is one
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

-- ── keepLastIfActive proto-next storage ──────────────────────────────────
-- When a job is deduplicated while its winner is *active* and keepLastIfActive
-- is set, the new job's payload is stashed here (Redis `dn:<id>` hash) and the
-- dedup key is persisted (no expiry). When the active winner finishes, the
-- stashed payload is turned into a real job (the new winner). At most one
-- proto-next exists per id; a later add while active overwrites it.
CREATE TABLE bullmq_dedup_next (
  queue    text  NOT NULL,
  dedup_id text  NOT NULL,
  payload  jsonb NOT NULL,  -- { name, data, opts, jobId }
  PRIMARY KEY (queue, dedup_id)
);

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
    INSERT INTO bullmq_meta (queue, field, value) VALUES (p_queue, 'id', '1')
      ON CONFLICT (queue, field)
      DO UPDATE SET value = (bullmq_meta.value::bigint + 1)::text
      RETURNING value INTO v_job_id;
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
        PERFORM bullmq_publish_event(p_queue, 'debounced',
          jsonb_build_object('jobId', p_job_id, 'debounceId', v_id));
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
      PERFORM bullmq_publish_event(p_queue, 'debounced',
        jsonb_build_object('jobId', v_cur, 'debounceId', v_id));
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
    PERFORM bullmq_publish_event(p_queue, 'debounced',
      jsonb_build_object('jobId', v_cur, 'debounceId', v_id));
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
    INSERT INTO bullmq_meta (queue, field, value)
      VALUES (p_queue, 'id', '1')
      ON CONFLICT (queue, field)
      DO UPDATE SET value = (bullmq_meta.value::bigint + 1)::text
      RETURNING value INTO v_id;
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

  IF v_inserted THEN
    PERFORM pg_notify('bullmq_jobs', p_queue);
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
