-- Publishes a message on a topic.
-- Params: $1 namespace, $2 topic, $3 data, $4 timestamp (ms), $5 retain (ms),
-- $6 max data size (bytes).
SELECT message_id, node_count, endpoint_count
  FROM relay_publish($1, $2, $3, $4, $5, $6);
