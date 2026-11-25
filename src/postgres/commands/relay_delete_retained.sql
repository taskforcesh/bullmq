-- Deletes the retained message of a topic; returns whether there was one.
-- Params: $1 namespace, $2 topic.
SELECT relay_delete_retained($1, $2) AS deleted;
