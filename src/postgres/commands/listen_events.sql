-- Subscribe to the shared event-stream channel. Producers
-- `pg_notify('bullmq_events', <queue>)`; a consumer filters for its own queue.
LISTEN bullmq_events;
