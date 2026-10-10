-- Subscribes a relay endpoint to a pattern; returns the retained message of
-- an exact topic atomically with the subscription.
-- Params: $1 namespace, $2 node id, $3 endpoint id, $4 pattern.
SELECT added, retained_mid, retained_ts, retained_data
  FROM relay_subscribe($1, $2, $3, $4);
