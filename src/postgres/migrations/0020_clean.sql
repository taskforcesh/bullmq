-- BullMQ PostgreSQL backend — clean jobs in a state (schema version 20).
--
-- Backs Queue.clean(): remove jobs of a given type older than a timestamp, up
-- to `limit` (0 = all), returning the removed ids. Finished states compare on
-- finished_at; others on added_at. NOTE: the interface name cleanJobsInSet is a
-- Redis-ism; conceptually this cleans jobs of a state, not a "set".
CREATE FUNCTION bullmq_clean(
  p_queue text, p_type text, p_ts bigint, p_limit integer
) RETURNS SETOF text
LANGUAGE plpgsql
SET search_path FROM CURRENT
AS $$
DECLARE
  v_where text;
BEGIN
  IF p_type IN ('completed', 'failed') THEN
    v_where := format('state = %L AND finished_at_ms <= %s', p_type, p_ts);
  ELSIF p_type = 'delayed' THEN
    v_where := format('state = ''delayed'' AND added_at_ms <= %s', p_ts);
  ELSIF p_type = 'prioritized' THEN
    v_where := format('state = ''waiting'' AND priority > 0 AND added_at_ms <= %s', p_ts);
  ELSIF p_type IN ('wait', 'waiting', 'paused') THEN
    v_where := format('state = ''waiting'' AND priority = 0 AND added_at_ms <= %s', p_ts);
  ELSIF p_type = 'active' THEN
    v_where := format('state = ''active'' AND added_at_ms <= %s', p_ts);
  ELSE
    RETURN;
  END IF;

  RETURN QUERY EXECUTE format(
    'DELETE FROM bullmq_job WHERE queue = %L AND id IN ('
    || 'SELECT id FROM bullmq_job WHERE queue = %L AND %s ORDER BY seq '
    || '%s) RETURNING id',
    p_queue, p_queue, v_where,
    CASE WHEN p_limit > 0 THEN 'LIMIT ' || p_limit ELSE '' END
  );
END;
$$;
