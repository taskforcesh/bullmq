-- Reusing an expired, unswept node starts with a clean inbox and subscriptions.
-- Refreshing a still-live registration preserves both.
CREATE OR REPLACE FUNCTION relay_register_node(p_ns text, p_node text, p_lease_ms bigint)
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
  INSERT INTO relay_node (ns, node_id, lease_until)
  VALUES (p_ns, p_node, clock_timestamp() + p_lease_ms * interval '1 millisecond')
  ON CONFLICT (ns, node_id)
  DO UPDATE SET lease_until = EXCLUDED.lease_until;
END;
$$;

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
