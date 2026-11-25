-- Relay: messaging between the nodes of a fleet (see the Relay class).
--
-- Additive migration: it only creates new relay_* objects and does not touch
-- the queue schema, so clients that don't use the relay are unaffected.
--
-- All routing logic lives here (and in the equivalent Lua scripts), so every
-- BullMQ runtime gets identical semantics. Error convention, as for the queue
-- functions: RAISE ... USING ERRCODE = 'BM001', DETAIL = '<negative code>'.
--   -1 invalid topic, -2 invalid pattern, -3 node not registered,
--   -4 data too large, -5 invalid id.

CREATE TABLE relay_node (
  ns text NOT NULL,
  node_id text NOT NULL,
  lease_until timestamptz NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_heartbeat timestamptz,
  -- As given by the node (name, host, pid, version...), for dashboards.
  info jsonb NOT NULL DEFAULT '{}',
  -- Unread inbox entries as of the last trim, and entries dropped by trims.
  backlog integer NOT NULL DEFAULT 0,
  dropped bigint NOT NULL DEFAULT 0,
  -- Ids of the inbox batch last fetched by the node (in flight until it is
  -- acknowledged): trims may remove them, but they are not dropped.
  in_flight bigint[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (ns, node_id)
);

-- Sweeps remove expired nodes of every namespace, so an abandoned namespace
-- is cleaned by any node using the same schema.
CREATE INDEX relay_node_lease_idx ON relay_node (lease_until);
CREATE INDEX relay_node_registered_idx ON relay_node (ns, registered_at);

CREATE TABLE relay_subscription (
  ns text NOT NULL,
  node_id text NOT NULL,
  endpoint_id text NOT NULL,
  pattern text NOT NULL,
  -- Wildcard patterns only: their literal first segment, or '*' for wildcard
  -- roots. NULL for exact topics, which publishes find by pattern directly.
  root text,
  PRIMARY KEY (ns, pattern, node_id, endpoint_id),
  FOREIGN KEY (ns, node_id) REFERENCES relay_node (ns, node_id) ON DELETE CASCADE
);

CREATE INDEX relay_subscription_root_idx ON relay_subscription (ns, root);
CREATE INDEX relay_subscription_endpoint_idx
  ON relay_subscription (ns, node_id, endpoint_id);

CREATE TABLE relay_inbox (
  id bigserial PRIMARY KEY,
  ns text NOT NULL,
  node_id text NOT NULL,
  kind text NOT NULL,
  topic text NOT NULL,
  mid bigint NOT NULL,
  ts bigint NOT NULL,
  data text NOT NULL,
  endpoints text[] NOT NULL,
  FOREIGN KEY (ns, node_id) REFERENCES relay_node (ns, node_id) ON DELETE CASCADE
);

CREATE INDEX relay_inbox_node_idx ON relay_inbox (ns, node_id, id);

CREATE TABLE relay_retained (
  ns text NOT NULL,
  topic text NOT NULL,
  mid bigint NOT NULL,
  ts bigint NOT NULL,
  data text NOT NULL,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (ns, topic)
);

-- Retained messages expire even if their namespace has no nodes left.
CREATE INDEX relay_retained_expiry_idx ON relay_retained (expires_at);

CREATE SEQUENCE relay_mid_seq;

-- Returns the segments of a valid topic (or pattern), or NULL if invalid.
-- Same grammar as includes/relayTopics.lua.
CREATE FUNCTION relay_parse_topic(p_value text, p_allow_wildcards boolean)
RETURNS text[]
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_segments text[];
  v_count integer;
  v_segment text;
BEGIN
  IF p_value IS NULL OR octet_length(p_value) = 0
     OR octet_length(p_value) > 512 THEN
    RETURN NULL;
  END IF;
  v_segments := string_to_array(p_value, '.');
  v_count := cardinality(v_segments);
  IF v_count > 16 THEN
    RETURN NULL;
  END IF;
  FOR i IN 1..v_count LOOP
    v_segment := v_segments[i];
    IF p_allow_wildcards AND v_segment = '*' THEN
      CONTINUE;
    END IF;
    IF p_allow_wildcards AND v_segment = '>' THEN
      IF i <> v_count THEN
        RETURN NULL;
      END IF;
      CONTINUE;
    END IF;
    IF v_segment !~ '^[A-Za-z0-9_:%-]+$' THEN
      RETURN NULL;
    END IF;
  END LOOP;
  RETURN v_segments;
END;
$$;

CREATE FUNCTION relay_match_topic(p_pattern text[], p_topic text[])
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_topic_count integer := cardinality(p_topic);
  v_pattern_count integer := cardinality(p_pattern);
BEGIN
  FOR i IN 1..v_pattern_count LOOP
    IF p_pattern[i] = '>' THEN
      RETURN v_topic_count >= i;
    END IF;
    IF i > v_topic_count THEN
      RETURN false;
    END IF;
    IF p_pattern[i] <> '*' AND p_pattern[i] <> p_topic[i] THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN v_pattern_count = v_topic_count;
END;
$$;

CREATE FUNCTION relay_is_valid_id(p_id text)
RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_id IS NOT NULL AND p_id ~ '^[A-Za-z0-9_-]{1,64}$';
$$;

-- Registers (or refreshes) a node. Reusing an expired, unswept node id
-- starts with a clean inbox and subscriptions; refreshing a live registration
-- preserves both.
CREATE FUNCTION relay_register_node(
  p_ns text, p_node text, p_lease_ms bigint, p_info jsonb
)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT relay_is_valid_id(p_node) THEN
    RAISE EXCEPTION 'bullmq: relay invalid node id %', p_node
      USING ERRCODE = 'BM001', DETAIL = '-5';
  END IF;
  DELETE FROM relay_node
   WHERE ns = p_ns AND node_id = p_node
     AND lease_until <= clock_timestamp();
  INSERT INTO relay_node (ns, node_id, lease_until, last_heartbeat, info)
  VALUES (
    p_ns, p_node, clock_timestamp() + p_lease_ms * interval '1 millisecond',
    clock_timestamp(), p_info
  )
  ON CONFLICT (ns, node_id)
  DO UPDATE SET lease_until = EXCLUDED.lease_until,
                last_heartbeat = EXCLUDED.last_heartbeat,
                info = EXCLUDED.info;
END;
$$;

-- Renews a node's lease. Returns false when the node is not registered or
-- its lease expired (even if not swept yet): the caller must register again
-- and restore its subscriptions.
CREATE FUNCTION relay_heartbeat(p_ns text, p_node text, p_lease_ms bigint)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE relay_node
     SET lease_until = clock_timestamp() + p_lease_ms * interval '1 millisecond',
         last_heartbeat = clock_timestamp()
   WHERE ns = p_ns AND node_id = p_node
     AND lease_until > clock_timestamp();
  RETURN FOUND;
END;
$$;

CREATE FUNCTION relay_unregister_node(p_ns text, p_node text)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM relay_node WHERE ns = p_ns AND node_id = p_node;
  RETURN FOUND;
END;
$$;

-- Removes up to p_limit expired nodes (their subscriptions and inbox go with
-- them) and up to p_limit expired retained messages, of every namespace, so
-- abandoned namespaces are cleaned too. Returns the removed nodes of p_ns.
CREATE FUNCTION relay_sweep(p_ns text, p_limit integer)
RETURNS SETOF text
LANGUAGE plpgsql AS $$
BEGIN
  WITH expired AS (
    SELECT r.ns, r.topic
      FROM relay_retained r
     WHERE r.expires_at < statement_timestamp()
     ORDER BY r.expires_at
     LIMIT p_limit
       FOR UPDATE SKIP LOCKED
  )
  DELETE FROM relay_retained r
   USING expired e
   WHERE r.ns = e.ns AND r.topic = e.topic;

  RETURN QUERY
    WITH expired AS (
      SELECT n.ns, n.node_id
        FROM relay_node n
       WHERE n.lease_until < clock_timestamp()
       ORDER BY n.lease_until
       LIMIT p_limit
         FOR UPDATE SKIP LOCKED
    ), removed AS (
      DELETE FROM relay_node n
       USING expired e
       WHERE n.ns = e.ns AND n.node_id = e.node_id
      RETURNING n.ns, n.node_id
    )
    SELECT removed.node_id FROM removed WHERE removed.ns = p_ns;
END;
$$;

-- Subscribes an endpoint to a pattern. For an exact topic the retained
-- message, if any, is returned atomically with the subscription.
--
-- Exact subscriptions and publishes on the same topic are serialized by an
-- advisory lock taken before either reads routing or retained state; each
-- statement after the lock gets a fresh READ COMMITTED snapshot, including
-- changes committed by the previous lock holder.
CREATE FUNCTION relay_subscribe(
  p_ns text, p_node text, p_endpoint text, p_pattern text
)
RETURNS TABLE (added boolean, retained_mid bigint, retained_ts bigint, retained_data text)
LANGUAGE plpgsql AS $$
DECLARE
  v_segments text[];
  v_has_wildcards boolean;
BEGIN
  IF NOT relay_is_valid_id(p_node) OR NOT relay_is_valid_id(p_endpoint) THEN
    RAISE EXCEPTION 'bullmq: relay invalid id'
      USING ERRCODE = 'BM001', DETAIL = '-5';
  END IF;
  v_segments := relay_parse_topic(p_pattern, true);
  IF v_segments IS NULL THEN
    RAISE EXCEPTION 'bullmq: relay invalid pattern %', p_pattern
      USING ERRCODE = 'BM001', DETAIL = '-2';
  END IF;
  v_has_wildcards := '*' = ANY (v_segments) OR '>' = ANY (v_segments);
  IF NOT v_has_wildcards THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_ns), hashtext(p_pattern));
  END IF;

  -- Keep the live node registered until its subscription is stored.
  PERFORM 1 FROM relay_node
    WHERE ns = p_ns AND node_id = p_node
      AND lease_until > clock_timestamp()
    FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bullmq: relay node % not registered', p_node
      USING ERRCODE = 'BM001', DETAIL = '-3';
  END IF;

  INSERT INTO relay_subscription (ns, node_id, endpoint_id, pattern, root)
  VALUES (
    p_ns, p_node, p_endpoint, p_pattern,
    CASE
      WHEN NOT v_has_wildcards THEN NULL
      WHEN v_segments[1] IN ('*', '>') THEN '*'
      ELSE v_segments[1]
    END
  )
  ON CONFLICT DO NOTHING;
  added := FOUND;

  IF NOT v_has_wildcards THEN
    SELECT r.mid, r.ts, r.data
      INTO retained_mid, retained_ts, retained_data
      FROM relay_retained r
     WHERE r.ns = p_ns AND r.topic = p_pattern
       AND r.expires_at >= clock_timestamp();
  END IF;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION relay_remove_endpoint(p_ns text, p_node text, p_endpoint text)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  WITH removed AS (
    DELETE FROM relay_subscription
     WHERE ns = p_ns AND node_id = p_node AND endpoint_id = p_endpoint
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM removed;
  RETURN v_count;
END;
$$;

-- Publishes a message: one inbox row per live node with matching
-- subscriptions, listing that node's endpoints (each endpoint once), and a
-- NOTIFY per node to wake it up.
CREATE FUNCTION relay_publish(
  p_ns text, p_topic text, p_data text, p_ts bigint,
  p_retain_ms bigint, p_max_size integer
)
RETURNS TABLE (message_id bigint, node_count integer, endpoint_count integer)
LANGUAGE plpgsql AS $$
DECLARE
  v_segments text[];
  v_row record;
BEGIN
  v_segments := relay_parse_topic(p_topic, false);
  IF v_segments IS NULL THEN
    RAISE EXCEPTION 'bullmq: relay invalid topic %', p_topic
      USING ERRCODE = 'BM001', DETAIL = '-1';
  END IF;
  IF octet_length(p_data) > p_max_size THEN
    RAISE EXCEPTION 'bullmq: relay data too large'
      USING ERRCODE = 'BM001', DETAIL = '-4';
  END IF;

  -- See relay_subscribe.
  PERFORM pg_advisory_xact_lock(hashtext(p_ns), hashtext(p_topic));
  message_id := nextval('relay_mid_seq');
  node_count := 0;
  endpoint_count := 0;

  IF p_retain_ms > 0 THEN
    INSERT INTO relay_retained (ns, topic, mid, ts, data, expires_at)
    VALUES (
      p_ns, p_topic, message_id, p_ts, p_data,
      clock_timestamp() + p_retain_ms * interval '1 millisecond'
    )
    ON CONFLICT (ns, topic) DO UPDATE
      SET mid = EXCLUDED.mid, ts = EXCLUDED.ts, data = EXCLUDED.data,
          expires_at = EXCLUDED.expires_at;
  END IF;

  FOR v_row IN
    WITH matched AS (
      -- Exact subscriptions: a primary-key lookup, whatever their number.
      SELECT s.node_id, s.endpoint_id
        FROM relay_subscription s
       WHERE s.ns = p_ns AND s.pattern = p_topic
      UNION ALL
      -- Wildcard subscriptions: only those indexed under the topic's first
      -- segment (or a wildcard root) are matched one by one.
      SELECT s.node_id, s.endpoint_id
        FROM relay_subscription s
       WHERE s.ns = p_ns
         AND s.root IN (v_segments[1], '*')
         AND relay_match_topic(string_to_array(s.pattern, '.'), v_segments)
    ), live AS (
      -- Locks the target nodes so a concurrent sweep can't delete them before
      -- their inbox rows are inserted (the sweep skips locked nodes; a node it
      -- deleted first is simply not returned here).
      SELECT n.node_id
        FROM relay_node n
       WHERE n.ns = p_ns
         AND n.node_id IN (SELECT matched.node_id FROM matched)
         AND n.lease_until >= clock_timestamp()
         FOR KEY SHARE
    )
    INSERT INTO relay_inbox (ns, node_id, kind, topic, mid, ts, data, endpoints)
    SELECT p_ns, m.node_id, 'msg', p_topic, message_id, p_ts, p_data,
           array_agg(DISTINCT m.endpoint_id ORDER BY m.endpoint_id)
      FROM matched m
      JOIN live l ON l.node_id = m.node_id
     GROUP BY m.node_id
    RETURNING relay_inbox.node_id AS node_id,
              cardinality(relay_inbox.endpoints) AS endpoint_total
  LOOP
    node_count := node_count + 1;
    endpoint_count := endpoint_count + v_row.endpoint_total;
    PERFORM pg_notify('bullmq_relay', p_ns || ':' || v_row.node_id);
  END LOOP;

  RETURN NEXT;
END;
$$;

-- Acknowledges (deletes) the given inbox entries, then returns the oldest
-- remaining ones. Acknowledging by id rather than reading after a cursor never
-- skips a row whose transaction committed late. Returns nothing while the
-- node's lease is expired: its pending entries belong to a registration that
-- recovery replaces, so they must not be delivered after it. The returned
-- ids are recorded as in flight on the node, atomically with the read (the
-- node row lock serializes it with trims), so a trim that runs before the
-- reader gets them does not count them as dropped.
CREATE FUNCTION relay_read_inbox(
  p_ns text, p_node text, p_ack bigint[], p_limit integer
)
RETURNS SETOF relay_inbox
LANGUAGE plpgsql AS $$
DECLARE
  v_rows relay_inbox[];
BEGIN
  -- Lock the node before its inbox rows, as relay_trim_inbox does.
  PERFORM 1 FROM relay_node
    WHERE ns = p_ns AND node_id = p_node
    FOR NO KEY UPDATE;
  IF cardinality(p_ack) > 0 THEN
    DELETE FROM relay_inbox
     WHERE ns = p_ns AND node_id = p_node AND id = ANY (p_ack);
  END IF;
  SELECT coalesce(array_agg(b ORDER BY b.id), '{}') INTO v_rows
    FROM (
      SELECT i.*
        FROM relay_inbox i
       WHERE i.ns = p_ns AND i.node_id = p_node
         AND EXISTS (
           SELECT 1
             FROM relay_node n
            WHERE n.ns = p_ns AND n.node_id = p_node
              AND n.lease_until > clock_timestamp()
         )
       ORDER BY i.id
       LIMIT p_limit
    ) b;
  UPDATE relay_node
     SET in_flight = ARRAY(SELECT r.id FROM unnest(v_rows) r)
   WHERE ns = p_ns AND node_id = p_node;
  RETURN QUERY SELECT r.* FROM unnest(v_rows) r ORDER BY r.id;
END;
$$;

-- Removes the consumed entries of a node's inbox (the ids of its last read
-- batch) and the oldest entries beyond p_max_len, and returns the number of
-- entries left: the messages the node hasn't read yet. The backlog and the
-- number of dropped entries are recorded on the node. Entries of the batch in
-- flight are delivered by the reader, so they are not counted as dropped.
CREATE FUNCTION relay_trim_inbox(
  p_ns text, p_node text, p_ack bigint[], p_max_len integer
)
RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_oldest_kept bigint;
  v_dropped integer := 0;
  v_count integer;
  v_in_flight bigint[];
BEGIN
  -- Lock the node before its inbox rows, in the same order as unregistering
  -- and sweeping (which delete the node, then cascade to its inbox).
  SELECT in_flight INTO v_in_flight FROM relay_node
    WHERE ns = p_ns AND node_id = p_node
    FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF cardinality(p_ack) > 0 THEN
    DELETE FROM relay_inbox
     WHERE ns = p_ns AND node_id = p_node AND id = ANY (p_ack);
  END IF;

  SELECT id INTO v_oldest_kept
    FROM relay_inbox
   WHERE ns = p_ns AND node_id = p_node
   ORDER BY id DESC
  OFFSET p_max_len - 1
   LIMIT 1;
  IF v_oldest_kept IS NOT NULL THEN
    WITH removed AS (
      DELETE FROM relay_inbox
       WHERE ns = p_ns AND node_id = p_node AND id < v_oldest_kept
      RETURNING id
    )
    SELECT count(*)::integer INTO v_dropped
      FROM removed
     WHERE removed.id <> ALL (v_in_flight);
  END IF;

  SELECT count(*)::integer INTO v_count
    FROM relay_inbox
   WHERE ns = p_ns AND node_id = p_node;
  UPDATE relay_node
     SET backlog = v_count, dropped = dropped + v_dropped
   WHERE ns = p_ns AND node_id = p_node;
  RETURN v_count;
END;
$$;

-- Deletes the retained message of a topic; returns whether there was one.
CREATE FUNCTION relay_delete_retained(p_ns text, p_topic text)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  IF relay_parse_topic(p_topic, false) IS NULL THEN
    RAISE EXCEPTION 'bullmq: relay invalid topic %', p_topic
      USING ERRCODE = 'BM001', DETAIL = '-1';
  END IF;
  -- Same lock as publishes and exact subscriptions of the topic.
  PERFORM pg_advisory_xact_lock(hashtext(p_ns), hashtext(p_topic));
  DELETE FROM relay_retained
   WHERE ns = p_ns AND topic = p_topic
     AND expires_at >= clock_timestamp();
  RETURN FOUND;
END;
$$;

-- Read-only getters, for dashboards. Pages are inclusive [p_start, p_end]
-- positions (p_end < 0: to the end); orders match the Redis backend (bytewise
-- on the same composite values), so pagination behaves the same.

CREATE FUNCTION relay_ms(p_time timestamptz)
RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT floor(extract(epoch FROM p_time) * 1000)::bigint;
$$;

CREATE FUNCTION relay_page_limit(p_start integer, p_end integer)
RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_end < 0 THEN NULL ELSE greatest(p_end - p_start + 1, 0) END;
$$;

CREATE FUNCTION relay_get_counts(p_ns text)
RETURNS TABLE (nodes integer, subscriptions integer, patterns integer, retained integer)
LANGUAGE sql STABLE AS $$
  SELECT
    (SELECT count(*)::integer FROM relay_node WHERE ns = p_ns),
    (SELECT count(*)::integer FROM relay_subscription WHERE ns = p_ns),
    (SELECT count(DISTINCT pattern)::integer
       FROM relay_subscription WHERE ns = p_ns),
    (SELECT count(*)::integer FROM relay_retained
      WHERE ns = p_ns AND expires_at > clock_timestamp());
$$;

-- Nodes by registration. A node whose lease expired (not swept yet) is listed
-- without its info and stats, as on Redis.
CREATE FUNCTION relay_get_nodes(p_ns text, p_start integer, p_end integer)
RETURNS TABLE (
  node_id text, registered_at bigint, lease_until bigint, info jsonb,
  last_heartbeat bigint, backlog integer, dropped bigint, subscriptions integer
)
LANGUAGE sql STABLE AS $$
  SELECT n.node_id, relay_ms(n.registered_at), relay_ms(n.lease_until),
         CASE WHEN n.lease_until > clock_timestamp() THEN n.info END,
         CASE WHEN n.lease_until > clock_timestamp()
              THEN relay_ms(n.last_heartbeat) END,
         CASE WHEN n.lease_until > clock_timestamp() THEN n.backlog ELSE 0 END,
         CASE WHEN n.lease_until > clock_timestamp() THEN n.dropped ELSE 0 END,
         (SELECT count(*)::integer FROM relay_subscription s
           WHERE s.ns = n.ns AND s.node_id = n.node_id)
    FROM relay_node n
   WHERE n.ns = p_ns
   ORDER BY n.registered_at, n.node_id COLLATE "C"
  OFFSET p_start
   LIMIT relay_page_limit(p_start, p_end);
$$;

-- All subscriptions (by node, endpoint, pattern), or those of a node (by
-- endpoint, pattern) or of a pattern (by node, endpoint).
CREATE FUNCTION relay_get_subscriptions(
  p_ns text, p_node text, p_pattern text, p_start integer, p_end integer
)
RETURNS TABLE (node_id text, endpoint_id text, pattern text)
LANGUAGE sql STABLE AS $$
  SELECT s.node_id, s.endpoint_id, s.pattern
    FROM relay_subscription s
   WHERE s.ns = p_ns
     AND (p_node IS NULL OR s.node_id = p_node)
     AND (p_pattern IS NULL OR s.pattern = p_pattern)
   ORDER BY (CASE
              WHEN p_node IS NOT NULL THEN s.endpoint_id || '|' || s.pattern
              WHEN p_pattern IS NOT NULL THEN s.node_id || '|' || s.endpoint_id
              ELSE s.node_id || '|' || s.endpoint_id || '|' || s.pattern
            END) COLLATE "C"
  OFFSET p_start
   LIMIT relay_page_limit(p_start, p_end);
$$;

CREATE FUNCTION relay_get_patterns(p_ns text, p_start integer, p_end integer)
RETURNS TABLE (pattern text, subscriptions integer)
LANGUAGE sql STABLE AS $$
  SELECT s.pattern, count(*)::integer
    FROM relay_subscription s
   WHERE s.ns = p_ns
   GROUP BY s.pattern
   ORDER BY s.pattern COLLATE "C"
  OFFSET p_start
   LIMIT relay_page_limit(p_start, p_end);
$$;

CREATE FUNCTION relay_get_retained(p_ns text, p_start integer, p_end integer)
RETURNS TABLE (topic text, expires_at bigint, mid bigint, ts bigint, data text)
LANGUAGE sql STABLE AS $$
  SELECT r.topic, relay_ms(r.expires_at), r.mid, r.ts, r.data
    FROM relay_retained r
   WHERE r.ns = p_ns AND r.expires_at > clock_timestamp()
   ORDER BY r.expires_at, r.topic COLLATE "C"
  OFFSET p_start
   LIMIT relay_page_limit(p_start, p_end);
$$;

-- Namespaces with live nodes or retained messages.
CREATE FUNCTION relay_get_namespaces()
RETURNS SETOF text
LANGUAGE sql STABLE AS $$
  SELECT u.ns FROM (
    SELECT ns FROM relay_node WHERE lease_until > clock_timestamp()
    UNION
    SELECT ns FROM relay_retained WHERE expires_at > clock_timestamp()
  ) u
  ORDER BY u.ns COLLATE "C";
$$;
