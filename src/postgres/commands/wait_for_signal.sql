-- Return a job's stored signal, or move the active job to delayed to wait
-- for it. Params: $1 queue, $2 id, $3 token, $4 name, $5 timeout_ms, $6 now_ms.
-- Returns code (1 signal, 0 delayed, 2 timed out, <0 error) and the payload.
SELECT o_code AS code, o_data::text AS data
  FROM wait_for_signal($1, $2, $3, $4, $5, $6);
