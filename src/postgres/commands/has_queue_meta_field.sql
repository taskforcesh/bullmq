-- Whether a queue metadata field exists. Params: $1 queue, $2 field.
SELECT EXISTS(
  SELECT 1 FROM bullmq_meta WHERE queue = $1 AND field = $2
) AS exists;
