-- Worker registry: the live Workers of each queue (see Queue.getWorkers).
--
-- Additive migration: it only creates new worker_* objects and does not touch
-- the queue schema, so clients that don't use the registry are unaffected.
--
-- All registration logic lives here (and in the equivalent Lua scripts), so
-- every BullMQ runtime gets identical semantics. Error convention, as for the
-- queue functions: RAISE ... USING ERRCODE = 'BM001', DETAIL = '<negative code>'.
--   -1 invalid id.

CREATE TABLE worker_registration (
  -- The queue the Worker is registered for (e.g. emails).
  queue text NOT NULL,
  -- Random per-Worker id chosen by the client.
  worker_id text NOT NULL,
  lease_until timestamptz NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_heartbeat timestamptz,
  -- As given by the Worker (name, host, pid, version...), for getWorkers().
  info jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (queue, worker_id)
);

-- Sweeps remove expired Workers of every queue
CREATE INDEX worker_registration_lease_idx ON worker_registration (lease_until);

-- Registers (or refreshes) a Worker. Reusing an expired, unswept Worker id
-- starts a fresh registration; refreshing a live registration preserves its
-- registered_at.
CREATE FUNCTION worker_register(
  p_queue text, p_worker text, p_lease_ms bigint, p_info jsonb
)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_worker IS NULL OR p_worker !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'bullmq: worker invalid id %', p_worker
      USING ERRCODE = 'BM001', DETAIL = '-1';
  END IF;
  DELETE FROM worker_registration
   WHERE queue = p_queue AND worker_id = p_worker
     AND lease_until <= clock_timestamp();
  INSERT INTO worker_registration (queue, worker_id, lease_until, last_heartbeat, info)
  VALUES (
    p_queue, p_worker, clock_timestamp() + p_lease_ms * interval '1 millisecond',
    clock_timestamp(), coalesce(p_info, '{}')
  )
  ON CONFLICT (queue, worker_id)
  DO UPDATE SET lease_until = EXCLUDED.lease_until,
                last_heartbeat = EXCLUDED.last_heartbeat,
                info = EXCLUDED.info;
END;
$$;

-- Renews a Worker's lease. Returns false when the Worker is not registered or
-- its lease expired (even if not swept yet): the caller must register again.
CREATE FUNCTION worker_heartbeat(p_queue text, p_worker text, p_lease_ms bigint)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE worker_registration
     SET lease_until = clock_timestamp() + p_lease_ms * interval '1 millisecond',
         last_heartbeat = clock_timestamp()
   WHERE queue = p_queue AND worker_id = p_worker
     AND lease_until > clock_timestamp();
  RETURN FOUND;
END;
$$;

CREATE FUNCTION worker_unregister(p_queue text, p_worker text)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM worker_registration WHERE queue = p_queue AND worker_id = p_worker;
  RETURN FOUND;
END;
$$;

-- Removes up to p_limit expired Workers, of every queue, so abandoned queues
-- are cleaned too. Returns the removed Workers of p_queue.
CREATE FUNCTION worker_sweep(p_queue text, p_limit integer)
RETURNS SETOF text
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
    WITH expired AS (
      SELECT r.queue, r.worker_id
        FROM worker_registration r
       WHERE r.lease_until < clock_timestamp()
       ORDER BY r.lease_until
       LIMIT p_limit
         FOR UPDATE SKIP LOCKED
    ), removed AS (
      DELETE FROM worker_registration r
       USING expired e
       WHERE r.queue = e.queue AND r.worker_id = e.worker_id
      RETURNING r.queue, r.worker_id
    )
    SELECT removed.worker_id FROM removed WHERE removed.queue = p_queue;
END;
$$;

-- Read-only getters, for getWorkers().

CREATE FUNCTION worker_ms(p_time timestamptz)
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT floor(extract(epoch FROM p_time) * 1000)::bigint;
$$;

-- Workers by registration. A Worker whose lease expired (not swept yet) is
-- not listed, as on Redis.
CREATE FUNCTION worker_list(p_queue text)
RETURNS TABLE (
  worker_id text, registered_at bigint, lease_until bigint, info jsonb,
  last_heartbeat bigint
)
LANGUAGE sql STABLE AS $$
  SELECT r.worker_id, worker_ms(r.registered_at), worker_ms(r.lease_until), r.info,
         worker_ms(r.last_heartbeat)
    FROM worker_registration r
   WHERE r.queue = p_queue
     AND r.lease_until > clock_timestamp()
   ORDER BY r.registered_at, r.worker_id COLLATE "C";
$$;
