-- Serialize exact subscriptions and publishes before either reads routing or
-- retained state. Each statement after the lock gets a fresh READ COMMITTED
-- snapshot, including changes committed by the previous lock holder.
CREATE OR REPLACE FUNCTION relay_subscribe(
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

CREATE OR REPLACE FUNCTION relay_publish(
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

-- Retained messages must expire even if their namespace has no nodes left.
DROP INDEX relay_retained_expiry_idx;
CREATE INDEX relay_retained_expiry_idx ON relay_retained (expires_at);

CREATE OR REPLACE FUNCTION relay_sweep(p_ns text, p_limit integer)
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
