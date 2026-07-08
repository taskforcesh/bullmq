-- Move an active parent to waiting-children if it has pending children.
-- Params: $1 queue, $2 id, $3 token. Returns 1 (should wait), 0 (proceed).
SELECT bullmq_move_to_waiting_children($1, $2, $3) AS code;
