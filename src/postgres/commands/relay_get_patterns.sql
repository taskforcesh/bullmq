-- Subscribed patterns of a relay namespace, with their subscriptions.
-- Params: $1 namespace, $2 start, $3 end (inclusive, -1: to the end).
SELECT pattern, subscriptions FROM relay_get_patterns($1, $2, $3);
