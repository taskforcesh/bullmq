-- A single queue metadata field's value. Params: $1 queue, $2 field.
SELECT value FROM meta WHERE queue = $1 AND field = $2;
