-- Removes a node's consumed inbox entries and those beyond the max length;
-- returns the number left.
-- Params: $1 namespace, $2 node id, $3 ids of the last read batch, $4 max length.
SELECT relay_trim_inbox($1, $2, $3::bigint[], $4) AS backlog;
