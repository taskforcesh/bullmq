-- Connected BullMQ clients, mirroring Redis `CLIENT LIST` for worker/queue
-- discovery. Each long-lived worker / QueueEvents listener names its dedicated
-- connection via `application_name` (the PostgreSQL analogue of
-- `CLIENT SETNAME`), so listing the named sessions on this database reproduces
-- the same discovery surface. Pooled query connections leave `application_name`
-- empty and are excluded. One row per connection; the backend formats them into
-- `name=<application_name>` lines for the shared client-list parser.
SELECT application_name
FROM pg_stat_activity
WHERE datname = current_database()
  AND application_name <> '';
