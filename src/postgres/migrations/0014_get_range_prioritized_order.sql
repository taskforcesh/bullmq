-- Fix the descending order of prioritized jobs, schema version 14.
--
-- On Redis, prioritized jobs are a sorted set scored by priority and then
-- insertion order, read with ZRANGE or ZREVRANGE. For a descending range,
-- 0002 and 0013 built `ORDER BY priority, seq DESC`, which reversed only
-- `seq`: with priorities 3, 1, 2, Redis returned 3, 2, 1 and PostgreSQL
-- 1, 2, 3. The direction now applies to both columns. Ascending ranges and
-- every other state are unchanged from 0013.
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
  v_list   boolean := false;
BEGIN
  IF p_type IN ('wait', 'waiting') THEN
    v_where := 'state = ''waiting'' AND priority = 0'; v_order := 'seq'; v_list := true;
  ELSIF p_type = 'prioritized' THEN
    -- The query below appends v_dir to seq; priority needs it too.
    v_where := 'state = ''waiting'' AND priority > 0'; v_order := format('priority %s, seq', v_dir);
  ELSIF p_type = 'active' THEN
    v_where := 'state = ''active'''; v_order := 'seq'; v_list := true;
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

  IF v_list THEN
    -- Slice in the requested direction, return newest first (see 0013).
    RETURN QUERY EXECUTE format(
      'SELECT id FROM (SELECT id, seq FROM job WHERE queue = %L AND %s ORDER BY seq %s OFFSET %s LIMIT %s) page ORDER BY seq DESC',
      p_queue, v_where, v_dir, v_offset, v_limit
    );
    RETURN;
  END IF;

  RETURN QUERY EXECUTE format(
    'SELECT id FROM job WHERE queue = %L AND %s ORDER BY %s %s OFFSET %s LIMIT %s',
    p_queue, v_where, v_order, v_dir, v_offset, v_limit
  );
END;
$$;
