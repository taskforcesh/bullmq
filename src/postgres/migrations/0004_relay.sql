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
  PRIMARY KEY (ns, node_id)
);

CREATE INDEX relay_node_lease_idx ON relay_node (ns, lease_until);

CREATE TABLE relay_subscription (
  ns text NOT NULL,
  node_id text NOT NULL,
  endpoint_id text NOT NULL,
  pattern text NOT NULL,
  -- Literal first segment of the pattern, or '*' for wildcard roots.
  root text NOT NULL,
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

CREATE INDEX relay_retained_expiry_idx ON relay_retained (ns, expires_at);

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

CREATE FUNCTION relay_register_node(p_ns text, p_node text, p_lease_ms bigint)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT relay_is_valid_id(p_node) THEN
    RAISE EXCEPTION 'bullmq: relay invalid node id %', p_node
      USING ERRCODE = 'BM001', DETAIL = '-5';
  END IF;
  INSERT INTO relay_node (ns, node_id, lease_until)
  VALUES (p_ns, p_node, clock_timestamp() + p_lease_ms * interval '1 millisecond')
  ON CONFLICT (ns, node_id)
  DO UPDATE SET lease_until = EXCLUDED.lease_until;
END;
$$;

-- Renews a node's lease. Returns false when the node is not registered (it
-- was swept): the caller must register again and restore its subscriptions.
CREATE FUNCTION relay_heartbeat(p_ns text, p_node text, p_lease_ms bigint)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE relay_node
     SET lease_until = clock_timestamp() + p_lease_ms * interval '1 millisecond'
   WHERE ns = p_ns AND node_id = p_node;
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

-- Removes up to p_limit nodes whose lease expired (their subscriptions and
-- inbox go with them), and expired retained messages.
CREATE FUNCTION relay_sweep(p_ns text, p_limit integer)
RETURNS SETOF text
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM relay_retained
   WHERE ns = p_ns AND expires_at < clock_timestamp();
  RETURN QUERY
    WITH expired AS (
      SELECT n.ns, n.node_id
        FROM relay_node n
       WHERE n.ns = p_ns AND n.lease_until < clock_timestamp()
       LIMIT p_limit
         FOR UPDATE SKIP LOCKED
    ), removed AS (
      DELETE FROM relay_node n
       USING expired e
       WHERE n.ns = e.ns AND n.node_id = e.node_id
      RETURNING n.node_id
    )
    SELECT removed.node_id FROM removed;
END;
$$;

-- Subscribes an endpoint to a pattern. For an exact topic the retained
-- message, if any, is returned atomically with the subscription.
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
  -- Locks the node row so a concurrent sweep can't remove it meanwhile.
  PERFORM 1 FROM relay_node
    WHERE ns = p_ns AND node_id = p_node
    FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'bullmq: relay node % not registered', p_node
      USING ERRCODE = 'BM001', DETAIL = '-3';
  END IF;

  INSERT INTO relay_subscription (ns, node_id, endpoint_id, pattern, root)
  VALUES (
    p_ns, p_node, p_endpoint, p_pattern,
    CASE WHEN v_segments[1] IN ('*', '>') THEN '*' ELSE v_segments[1] END
  )
  ON CONFLICT DO NOTHING;
  added := FOUND;

  v_has_wildcards := '*' = ANY (v_segments) OR '>' = ANY (v_segments);
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
-- skips a row whose transaction committed late.
CREATE FUNCTION relay_read_inbox(
  p_ns text, p_node text, p_ack bigint[], p_limit integer
)
RETURNS SETOF relay_inbox
LANGUAGE plpgsql AS $$
BEGIN
  IF cardinality(p_ack) > 0 THEN
    DELETE FROM relay_inbox
     WHERE ns = p_ns AND node_id = p_node AND id = ANY (p_ack);
  END IF;
  RETURN QUERY
    SELECT *
      FROM relay_inbox
     WHERE ns = p_ns AND node_id = p_node
     ORDER BY id
     LIMIT p_limit;
END;
$$;
