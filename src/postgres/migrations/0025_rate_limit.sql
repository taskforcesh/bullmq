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
