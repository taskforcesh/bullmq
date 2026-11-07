# Redis™ out of memory

When Redis reaches its [`maxmemory`](https://redis.io/docs/latest/develop/reference/eviction/) limit with the recommended `noeviction` [policy](going-to-production.md#max-memory-policy), it rejects every command that could increase memory usage with an `OOM command not allowed when used memory > 'maxmemory'` error.

BullMQ handles this situation so that the jobs already stored in Redis can still be processed and memory can still be freed, while new jobs are rejected until there is room for them again.

## What keeps working

The following operations keep working while Redis is over `maxmemory`:

- Workers fetching jobs, completing them, failing them, retrying them (including backoffs) and moving them to `waiting-children`.
- Lock extension of active jobs and the recovery of stalled jobs, so long-running jobs are not marked as stalled.
- Operations that free memory: `job.remove()`, `job.removeUnprocessedChildren()`, `queue.clean()`, `queue.drain()` and `queue.obliterate()`.
- `queue.pause()`, so you can stop processing while you investigate.

If a worker command is still rejected with an OOM error, the worker retries it using an exponential backoff (starting at 100 ms and capped by the `runRetryDelay` worker option) and emits an `error` event on every attempt. It does not drop the operation, and it doesn't retry in a tight loop.

## What is rejected

Producer operations are rejected with the OOM error, which acts as backpressure:

- `queue.add()`, `queue.addBulk()` and `FlowProducer.add()`.
- Upserting job schedulers. A worker processing a job scheduler job emits an `error` event if it cannot add the next iteration, and it keeps processing the current job.
- `job.updateData()`, `job.updateProgress()` and `job.log()`.

Your producers must handle these errors, for example by retrying later or by storing the jobs somewhere else until Redis has memory again.

## Memory can exceed `maxmemory`

Because workers keep processing, memory usage can go over the `maxmemory` limit while Redis is out of memory. The overage is bounded, because no new jobs can be added, but it is not zero:

- Every processed job stores its `returnvalue`, `processedOn` and `finishedOn`.
- Every failed attempt stores its `failedReason` and adds a new entry to the job's stack traces. There is no limit on the number of stack traces by default.
- Events and metrics keep being written, although they are trimmed to `maxEvents` and `maxDataPoints`.

Be aware of a failure loop: if your processor calls `job.updateProgress()`, `job.log()` or `queue.add()` while Redis is out of memory, those calls fail, so the job fails. It is then retried until it runs out of `attempts`, storing a new stack trace every time.

## Recommendations

- **Leave headroom.** Set `maxmemory` well below the memory that is physically available to Redis, so the overage described above can't make the operating system kill Redis.
- **Remove finished jobs.** Use `removeOnComplete` and `removeOnFail` with an `age` and/or `count` (see [Auto-removal of jobs](queues/auto-removal-of-jobs.md)), so that processing jobs frees memory overall instead of only moving it around.
- **Limit stack traces.** Set the `stackTraceLimit` job option so failed attempts can't keep adding stack traces.
- **Keep `maxmemory-policy` as `noeviction`.** Any other policy lets Redis evict BullMQ keys, which corrupts your queues.
- **Monitor memory usage.** Alert on `used_memory` (from `INFO memory`) before it reaches `maxmemory`, and listen to `error` events in your workers and producers for OOM errors.
- **Free memory quickly.** If Redis runs out of memory, `queue.clean()`, `queue.drain()` and `job.remove()` still work and can be used to make room.
