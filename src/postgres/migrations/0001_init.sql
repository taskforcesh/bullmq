-- BullMQ PostgreSQL backend — initial schema (schema version 1).
--
-- This file is the *portable source of truth* for the schema. It uses only
-- standard SQL / PL-pgSQL so it can be shared verbatim with the future Elixir
-- and Python ports (which call the very same tables and functions).
--
-- All objects are created inside the backend's configured *schema* (the
-- connection-level namespace, default `bullmq`). The migration runner has
-- already created the schema and set `search_path` to it, so the unqualified
-- names below resolve into that schema. Unlike Redis — where a per-queue key
-- `prefix` namespaces every key — SQL uses the schema as the single namespace
-- for the whole connection, so there is no per-row/per-queue prefix.
--
-- The migration ledger table (`bullmq_migration`) is bootstrapped by the
-- migration runner itself, so it is intentionally not created here.
--
-- v1 only establishes the foundation that is independent of the job-storage
-- model: per-queue metadata. Subsequent migrations add the job tables,
-- indexes and the atomic operation functions.

-- Per-queue metadata. Mirrors the Redis `<prefix>:<queue>:meta` hash: a small
-- key/value store keyed by (queue, field). Used for the queue version, global
-- concurrency, global rate limit, paused flag, etc.
CREATE TABLE IF NOT EXISTS bullmq_meta (
  queue text NOT NULL,
  field text NOT NULL,
  value text,
  PRIMARY KEY (queue, field)
);
