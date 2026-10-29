-- Retained messages of a relay namespace, by expiry.
-- Params: $1 namespace, $2 start, $3 end (inclusive, -1: to the end).
SELECT topic, expires_at, mid, ts, data FROM relay_get_retained($1, $2, $3);
