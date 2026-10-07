-- Unregisters a relay node (its subscriptions and inbox are removed too).
-- Params: $1 namespace, $2 node id.
SELECT relay_unregister_node($1, $2) AS removed;
