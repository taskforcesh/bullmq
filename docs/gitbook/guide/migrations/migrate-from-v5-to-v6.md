---
description: Upgrade checklist and breaking-change summary for BullMQ v6.
---

# Migrate from v5 to v6

BullMQ v6 removes the legacy repeatable-job APIs introduced before Job Schedulers. Before upgrading, first move your application and your Redis data to the Job Scheduler model while you are still running v5.

## Recommended upgrade path

1. Upgrade to the latest BullMQ v5 release first.
2. Replace all uses of legacy repeatable-job APIs in your application code.
3. Recreate existing repeatable-job configurations as Job Schedulers.
4. Remove the legacy repeatable-job configurations from Redis.
5. Deploy BullMQ v6 only after every producer and worker is using Job Schedulers.

## Breaking changes summary

### Job Schedulers replace repeatable jobs

The following v5 APIs are removed in v6:

- `Queue.add(..., { repeat })`
- `Queue.addBulk(..., { repeat })`
- `Queue.getRepeatableJobs()`
- `Queue.removeRepeatable()`
- `Queue.removeRepeatableByKey()`
- `Repeat`

Use the Job Scheduler APIs instead:

- `queue.upsertJobScheduler(...)`
- `queue.getJobSchedulers()`
- `queue.removeJobScheduler(...)`

## Migrating legacy repeatable jobs

Legacy repeatable jobs stored by BullMQ v5 are not supported in BullMQ v6. If v6 encounters legacy repeatable-job metadata, it raises an error instead of trying to keep running with partially compatible behavior.

While still on v5, migrate each repeatable job with this flow:

1. Read the existing definitions with `queue.getRepeatableJobs()`.
2. For each repeatable job, create an equivalent Job Scheduler with `queue.upsertJobScheduler(...)`.
3. Verify the new scheduler is present with `queue.getJobSchedulers()`.
4. Remove the old repeatable-job definition with `queue.removeRepeatable(...)` or `queue.removeRepeatableByKey(...)`.
5. After all legacy entries are gone, deploy BullMQ v6 workers and producers.

### Mapping v5 repeat options to Job Schedulers

The repeat settings map directly:

- `repeat.pattern` → `upsertJobScheduler(..., { pattern })`
- `repeat.every` → `upsertJobScheduler(..., { every })`
- `repeat.limit` → `upsertJobScheduler(..., { limit })`
- `repeat.startDate` → `upsertJobScheduler(..., { startDate })`
- `repeat.endDate` → `upsertJobScheduler(..., { endDate })`
- `repeat.tz` → `upsertJobScheduler(..., { tz })`
- `repeat.utc: true` → `upsertJobScheduler(..., { tz: 'UTC' })`

Move the job name, data, and job options into the scheduler template argument:

```typescript
await queue.upsertJobScheduler(
  'paint-daily',
  {
    pattern: '0 15 3 * * *',
  },
  {
    name: 'paint',
    data: { color: 'blue' },
    opts: {
      attempts: 5,
      backoff: 3000,
    },
  },
);
```
