-- Acknowledges the given inbox entries and returns the oldest remaining ones.
-- Params: $1 namespace, $2 node id, $3 ids to acknowledge, $4 limit.
SELECT id, kind, topic, mid, ts, data, endpoints
  FROM relay_read_inbox($1, $2, $3::bigint[], $4);
