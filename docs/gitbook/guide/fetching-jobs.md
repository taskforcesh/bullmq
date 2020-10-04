# Fetching Jobs

BullMQ allows you to iterate through existing jobs using the methods `.getJobsFromIdPattern` and `.getJobsByName`.

## `.getJobsFromIdPattern`

Returns all jobs with IDs matching a specific pattern.

```typescript
import { Queue } from "bullmq";

const queue = new Queue('painter');

await queue.add("default", ... ,{ jobId: "foo.1" })
await queue.add("default", ..., { jobId: "foo.2" })
await queue.add("default", ..., { jobId: "bar.1" })

const result = await queue.fromIdPattern(
    "foo.*", // pattern to search for
    0 // cursor, initially 0
)

result.jobs // includes `foo.1` and `foo.2`, but not `bar.1`
result.newCursor // cursor to use for next iteration, `null` if scan is finished
```

{% hint style="info" %}
Uses Redis' `SCAN` internally and thus
will perform badly on big instances.
{% endhint %}

## `.getJobsByName`

Returns all jobs with a specific name.

```typescript
import { Queue } from "bullmq";

const queue = new Queue('painter');

await queue.add("foo", ...)
await queue.add("foo", ...)
await queue.add("bar", ...)

const result = await queue.getJobsByName(
    "foo",
    0 // cursor, initially 0
)

result.jobs // includes the first two jobs
result.newCursor // cursor to use for next iteration, `null` if scan is finished
```

{% hint style="info" %}
Uses Redis' `SSCAN` internally, which performs a lot better than `SCAN`.
Prefer this over `.getJobsFromIdPattern`, if possible.
{% endhint %}

