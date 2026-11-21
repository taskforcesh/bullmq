-- Fix list-backed ascending pagination: slice in ascending seq order before
-- returning, instead of slicing descending and reversing after pagination.
CREATE OR REPLACE FUNCTION get_range(
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
  IF p_type IN ('wait', 'waiting') THEN
    v_where := 'state = ''waiting'' AND priority = 0'; v_order := 'seq';
  ELSIF p_type = 'prioritized' THEN
    v_where := 'state = ''waiting'' AND priority > 0'; v_order := 'priority, seq';
  ELSIF p_type = 'active' THEN
    v_where := 'state = ''active'''; v_order := 'seq';
  ELSIF p_type = 'delayed' THEN
    v_where := 'state = ''delayed'''; v_order := 'process_at_ms';
  ELSIF p_type IN ('completed', 'failed') THEN
    v_where := format('state = %L', p_type); v_order := 'finished_at_ms';
  ELSIF p_type = 'waiting-children' THEN
    v_where := 'state = ''waiting-children'''; v_order := 'seq';
  ELSE
    RETURN;
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
    'SELECT id FROM job WHERE queue = %L AND %s ORDER BY %s %s OFFSET %s LIMIT %s',
    p_queue, v_where, v_order, v_dir, v_offset, v_limit
  );
END;
$$;
