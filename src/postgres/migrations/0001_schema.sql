-- BullMQ PostgreSQL backend — schema (types, sequences, tables, indexes).
--
-- Consolidated initial schema. All BullMQ objects live in a connection-level
-- schema (namespace); the operation functions live in 0002_functions.sql.

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

-- BullMQ PostgreSQL backend — core job schema (schema version 2).
--
-- Portable source of truth (standard SQL / PL-pgSQL) shared verbatim with the
-- future Elixir and Python ports. This migration establishes the *storage
-- model* (tables + indexes) for every BullMQ feature: FIFO/LIFO, priority,
-- delayed jobs, concurrency, locks/stalled detection, flows (parent/child
-- dependencies), deduplication, rate limiting, repeatable job schedulers, the
-- event stream and metrics. The atomic *operation* functions (addJob,
-- moveToActive, …) are layered on top in subsequent migrations.
--
-- ──────────────────────────────────────────────────────────────────────────
-- Design overview
-- ──────────────────────────────────────────────────────────────────────────
-- * Namespace = the connection's PostgreSQL *schema* (default `bullmq`), not a
--   per-queue key prefix. In Redis a `prefix` namespaces every key because the
--   keyspace is shared; in SQL the schema already isolates BullMQ from the
--   user's other tables, and a different schema (or database) gives a fully
--   independent BullMQ namespace. So there is no per-row/per-queue prefix — the
--   `queue` column alone discriminates within the schema.
--
-- * Single `bullmq_job` table keyed by (queue, id). The Redis adapter spreads a
--   job's lifecycle across many keys (wait list, prioritized zset, delayed zset,
--   active list, completed/failed zsets, locks, …); here a single `state`
--   column plus a handful of promoted, indexable columns replaces all of them.
--   State transitions are plain `UPDATE`s; claiming uses `FOR UPDATE SKIP
--   LOCKED` so concurrent workers never block each other.
--
-- * Time is stored as `bigint` epoch-milliseconds (suffix `_ms`) to match
--   BullMQ's millisecond API exactly and avoid timezone math on hot paths.
--
-- * Partial indexes are state-scoped: each hot path (claim next ready job,
--   promote due delayed jobs, find stalled active jobs, clean finished jobs)
--   has a small index that only contains the rows in the relevant state.
--
-- * "paused" and "prioritized" are NOT physical states. Pausing is an O(1)
--   queue-level flag in `bullmq_meta`; a prioritized job is simply a waiting job
--   with `priority > 0`. This avoids the bulk row rewrites Redis performs on
--   pause and removes the need for a separate prioritized structure — full
--   `ORDER BY (priority, seq)` does the job.
-- ──────────────────────────────────────────────────────────────────────────

-- Physical job states. (Pause = meta flag; prioritized = waiting + priority>0.)
CREATE TYPE bullmq_job_state AS ENUM (
  'waiting',
  'active',
  'completed',
  'failed',
  'delayed',
  'waiting-children'
);

-- Status of a parent→child dependency (flows).
CREATE TYPE bullmq_dep_status AS ENUM (
  'pending',    -- child not finished yet
  'processed',  -- child completed; `value` holds its return value
  'ignored',    -- child failed but parent was told to ignore it; `value` = reason
  'failed'      -- child failed and the failure is recorded against the parent
);

-- Global monotonic ordering for FIFO. A single sequence gives a total order
-- across all queues; FIFO within a queue is preserved because `seq` increases
-- with insertion. LIFO jobs are stored with a *negative* `seq` (from the same
-- sequence, negated) so they sort ahead of all FIFO jobs and, among themselves,
-- most-recently-added first — reproducing "last in, first out" with one column.
CREATE SEQUENCE bullmq_job_seq;

-- Global monotonic id for the event stream (the Postgres analogue of a Redis
-- stream entry id). Consumers page forward with `id > cursor`.
CREATE SEQUENCE bullmq_event_seq;

-- ──────────────────────────────────────────────────────────────────────────
-- Jobs
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE bullmq_job (
  queue             text             NOT NULL,
  id                text             NOT NULL,  -- custom id, or numeric counter as text
  seq               bigint           NOT NULL,  -- FIFO order (negative = LIFO); see sequence above
  name              text             NOT NULL,
  state             bullmq_job_state NOT NULL,

  -- Payload / options. BullMQ serializes these as JSON strings; stored as jsonb
  -- (always valid JSON) so they are queryable and compact.
  data              jsonb            NOT NULL DEFAULT '{}'::jsonb,
  opts              jsonb            NOT NULL DEFAULT '{}'::jsonb,

  -- Promoted, frequently-read scalars (also live implicitly in `opts`, but are
  -- broken out so they can be indexed / updated cheaply).
  priority          integer          NOT NULL DEFAULT 0,  -- 0 = no priority (FIFO); >0 = prioritized
  delay_ms          bigint           NOT NULL DEFAULT 0,
  max_attempts      integer          NOT NULL DEFAULT 1,
  attempts_made     integer          NOT NULL DEFAULT 0,
  attempts_started  integer          NOT NULL DEFAULT 0,

  -- Progress / results.
  progress          jsonb,                       -- number or object
  return_value      jsonb,                       -- BullMQ `returnvalue`
  failed_reason     text,
  stacktrace        jsonb,                       -- array of frames
  deferred_failure  text,
  processed_by      text,                        -- worker id that processed it

  -- Timestamps (epoch ms).
  added_at_ms       bigint           NOT NULL,   -- BullMQ `timestamp`
  process_at_ms     bigint,                       -- when a delayed job becomes ready
  processed_at_ms   bigint,                       -- BullMQ `processedOn`
  finished_at_ms    bigint,                       -- BullMQ `finishedOn`

  -- Locking / stalled detection. An active job is "locked" until
  -- `locked_until_ms`; once it elapses the job is considered stalled.
  lock_token        text,
  locked_until_ms   bigint,
  stalled_count     integer          NOT NULL DEFAULT 0,

  -- Deduplication / scheduler linkage.
  dedup_id          text,                         -- BullMQ deduplicationId / debounceId
  scheduler_id      text,                         -- id of the scheduler that produced this job (BullMQ repeatJobKey)

  -- Flow (parent/child) linkage. A child stores its parent's coordinates; a
  -- parent tracks how many children are still unfinished.
  parent_queue      text,
  parent_id         text,
  parent_key        text,                         -- denormalized "<queue>:<id>" (Redis-compatible "<prefix>:<queue>:<id>")
  pending_deps      integer          NOT NULL DEFAULT 0,
  -- Two-phase stalled mark/sweep: set on the first stalled pass, reclaimed on
  -- the next (see bullmq_move_stalled_jobs_to_wait in 0002_functions.sql).
  stalled_marked    boolean          NOT NULL DEFAULT false,

  PRIMARY KEY (queue, id)
);

-- Claim next ready job: waiting jobs ordered by (priority, seq). Covers both the
-- "wait" (priority = 0) and "prioritized" (priority > 0) views, and the FIFO/LIFO
-- ordering via the signed `seq`. Used with FOR UPDATE SKIP LOCKED.
CREATE INDEX bullmq_job_ready_idx
  ON bullmq_job (queue, priority, seq)
  WHERE state = 'waiting';

-- Promote due delayed jobs (process_at_ms <= now) and find the next wake-up.
CREATE INDEX bullmq_job_delayed_idx
  ON bullmq_job (queue, process_at_ms)
  WHERE state = 'delayed';

-- Active jobs: stalled scan by lock expiry, and O(1)-ish concurrency counting
-- (COUNT over the partial index for a queue).
CREATE INDEX bullmq_job_active_idx
  ON bullmq_job (queue, locked_until_ms)
  WHERE state = 'active';

-- Finished jobs: range listing and age/count-based retention + cleaning.
CREATE INDEX bullmq_job_finished_idx
  ON bullmq_job (queue, state, finished_at_ms)
  WHERE state IN ('completed', 'failed');

-- Parents blocked on children.
CREATE INDEX bullmq_job_waiting_children_idx
  ON bullmq_job (queue, seq)
  WHERE state = 'waiting-children';

-- Reverse lookup from a child to its parent (e.g. orphan/repair scans).
CREATE INDEX bullmq_job_parent_idx
  ON bullmq_job (parent_queue, parent_id)
  WHERE parent_id IS NOT NULL;

-- Locate the job(s) produced by a given scheduler.
CREATE INDEX bullmq_job_scheduler_idx
  ON bullmq_job (queue, scheduler_id)
  WHERE scheduler_id IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────
-- Job logs (append-only, per-job ordered lines)
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE bullmq_job_log (
  queue   text   NOT NULL,
  job_id  text   NOT NULL,
  idx     bigint NOT NULL,   -- per-job ordinal (0-based); range reads + trimming
  row     text   NOT NULL,
  PRIMARY KEY (queue, job_id, idx),
  FOREIGN KEY (queue, job_id)
    REFERENCES bullmq_job (queue, id) ON DELETE CASCADE
);

-- ──────────────────────────────────────────────────────────────────────────
-- Flow dependencies (parent → child)
-- ──────────────────────────────────────────────────────────────────────────
-- Owned by the parent. Reproduces BullMQ's processed/ignored/failed/unprocessed
-- child sets with a single `status` column, and stores each processed child's
-- return value (or failure reason) in `value`. `pending_deps` on the parent job
-- is the count of rows here still in 'pending'.
CREATE TABLE bullmq_job_dependency (
  parent_queue text NOT NULL,
  parent_id    text NOT NULL,
  child_queue  text NOT NULL,
  child_id     text NOT NULL,
  child_key    text NOT NULL,  -- denormalized "<queue>:<id>" (Redis-compatible "<prefix>:<queue>:<id>")
  status       bullmq_dep_status NOT NULL DEFAULT 'pending',
  value        jsonb,
  PRIMARY KEY (parent_queue, parent_id, child_key),
  FOREIGN KEY (parent_queue, parent_id)
    REFERENCES bullmq_job (queue, id) ON DELETE CASCADE
);

-- Paginate a parent's children by category (processed / pending / …).
CREATE INDEX bullmq_dep_parent_status_idx
  ON bullmq_job_dependency (parent_queue, parent_id, status);

-- Resolve dependencies from the child side (when a child finishes, or when a
-- child dependency is explicitly removed).
CREATE INDEX bullmq_dep_child_idx
  ON bullmq_job_dependency (child_queue, child_id);

-- ──────────────────────────────────────────────────────────────────────────
-- Event stream (QueueEvents)
-- ──────────────────────────────────────────────────────────────────────────
-- The Postgres analogue of the Redis events stream. `id` is globally monotonic;
-- consumers page forward with `id > cursor`. Blocking reads are delivered via
-- LISTEN/NOTIFY (the operation layer NOTIFYs on insert); trimming deletes the
-- lowest ids beyond the configured max length.
CREATE TABLE bullmq_event (
  queue         text   NOT NULL,
  id            bigint NOT NULL DEFAULT nextval('bullmq_event_seq'),
  event         text   NOT NULL,
  data          jsonb  NOT NULL DEFAULT '{}'::jsonb,
  created_at_ms bigint NOT NULL,
  PRIMARY KEY (queue, id)
);

CREATE TABLE bullmq_metrics (
  queue      text     NOT NULL,
  kind       text     NOT NULL,  -- 'completed' | 'failed'
  count      bigint   NOT NULL DEFAULT 0,  -- cumulative finished jobs
  prev_ts    bigint,                        -- ts of the last data point
  prev_count bigint   NOT NULL DEFAULT 0,   -- count at the last data point
  data       bigint[] NOT NULL DEFAULT '{}',-- per-minute deltas, newest first
  PRIMARY KEY (queue, kind)
);

-- ──────────────────────────────────────────────────────────────────────────
-- Rate limiting (token window per queue)
-- ──────────────────────────────────────────────────────────────────────────
-- One row per queue holding the current limiter window: `points` counts the
-- jobs consumed in the window, which ends at `expire_at_ms`. Mirrors the single
-- Redis `<prefix>:<queue>:limiter` counter key (with its PTTL). The global
-- limiter is the only mode the open-source backend supports (per-group rate
-- limiting was removed in BullMQ 3.0).
CREATE TABLE bullmq_rate_limit (
  queue        text    NOT NULL,
  points       bigint  NOT NULL DEFAULT 0,
  expire_at_ms bigint  NOT NULL,
  PRIMARY KEY (queue)
);

-- ──────────────────────────────────────────────────────────────────────────
-- Deduplication keys
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE bullmq_dedup (
  queue        text   NOT NULL,
  dedup_id     text   NOT NULL,
  job_id       text   NOT NULL,
  expire_at_ms bigint,            -- NULL = no expiry; otherwise lazily reclaimed
  PRIMARY KEY (queue, dedup_id)
);

-- Expired dedup keys are reclaimed lazily by operation functions in
-- 0002_functions.sql (for example bullmq_deduplicate_job and
-- bullmq_dedup_finalize). This index keeps those lookups/deletes efficient.
CREATE INDEX bullmq_dedup_expire_idx
  ON bullmq_dedup (queue, expire_at_ms)
  WHERE expire_at_ms IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────
-- Job schedulers (repeatable jobs)
--
-- A scheduler is a job factory: it stores a template (data/opts) plus a repeat
-- spec (cron `pattern` or fixed `every` ms) and, on each upsert, produces the
-- next delayed job `repeat:<schedulerId>:<nextMillis>`. For cron the caller
-- computes nextMillis (JS cron-parser); for `every` the backend computes it,
-- honouring `offset_ms` (the phase offset from `start_date`).
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE bullmq_scheduler (
  queue           text   NOT NULL,
  scheduler_id    text   NOT NULL,
  name            text,
  next_run_ms     bigint,            -- next iteration's due time
  pattern         text,              -- cron expression (mutually exclusive with every_ms)
  every_ms        bigint,            -- fixed interval in ms
  tz              text,              -- timezone for cron evaluation
  start_date_ms   bigint,
  end_date_ms     bigint,
  limit_count     integer,           -- max number of iterations (NULL = unlimited)
  iteration_count integer NOT NULL DEFAULT 0,
  template_data   jsonb,             -- payload template reused for every iteration
  template_opts   jsonb,             -- options template reused for every iteration
  producer_id     text,
  offset_ms       bigint,            -- 'every' phase offset from start_date
  PRIMARY KEY (queue, scheduler_id)
);

-- Find schedulers whose next iteration is due, and order schedulers by next run.
CREATE INDEX bullmq_scheduler_next_idx
  ON bullmq_scheduler (queue, next_run_ms);

-- ── keepLastIfActive proto-next storage ──────────────────────────────────
-- When a job is deduplicated while its winner is *active* and keepLastIfActive
-- is set, the new job's payload is stashed here (Redis `dn:<id>` hash) and the
-- dedup key is persisted (no expiry). When the active winner finishes, the
-- stashed payload is turned into a real job (the new winner). At most one
-- proto-next exists per id; a later add while active overwrites it.
CREATE TABLE bullmq_dedup_next (
  queue    text  NOT NULL,
  dedup_id text  NOT NULL,
  payload  jsonb NOT NULL,  -- { name, data, opts, jobId }
  PRIMARY KEY (queue, dedup_id)
);
