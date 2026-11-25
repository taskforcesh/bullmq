-- Store a signal on a job and wake it if it is waiting for it.
-- Params: $1 queue, $2 id, $3 name, $4 data (jsonb), $5 now_ms.
-- Returns 1 woken, 0 stored, -1 missing job, -12 job already finished.
SELECT signal_job($1, $2, $3, $4::jsonb, $5) AS code;
