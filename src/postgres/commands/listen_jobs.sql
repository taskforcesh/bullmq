-- Subscribe to the shared job-notification channel (fixed name keeps this
-- portable). Producers `pg_notify('bullmq_jobs', <queue>)`; a worker filters
-- notifications for its own queue.
LISTEN bullmq_jobs;
