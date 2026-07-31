-- Insert a flow (tree) of jobs atomically. Param: $1 entries (jsonb array,
-- ordered roots-first). Returns the job ids in input order.
SELECT id FROM bullmq_add_flow($1::jsonb) AS t(id);
