-- Totals of a relay namespace.
-- Params: $1 namespace.
SELECT nodes, subscriptions, patterns, retained FROM relay_get_counts($1);
