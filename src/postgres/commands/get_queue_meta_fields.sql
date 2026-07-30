-- Several queue metadata fields. Params: $1 queue, $2 fields (text[]).
SELECT field, value FROM bullmq_meta
 WHERE queue = $1 AND field = ANY($2::text[]);
