-- Expired leases require recovery even before another node sweeps them.
CREATE OR REPLACE FUNCTION relay_heartbeat(p_ns text, p_node text, p_lease_ms bigint)
RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE relay_node
     SET lease_until = clock_timestamp() + p_lease_ms * interval '1 millisecond'
   WHERE ns = p_ns AND node_id = p_node
     AND lease_until > clock_timestamp();
  RETURN FOUND;
END;
$$;
