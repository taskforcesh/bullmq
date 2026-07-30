-- Insert a single job, routing it to waiting or delayed; returns its id.
SELECT bullmq_add_job(
  $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9,
  $10, $11, $12, $13, $14, $15
) AS id;
