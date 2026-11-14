# Prioritized

Jobs can also include a `priority` option. Using priorities, job processing order will be affected by the specified `priority` instead of following a FIFO or LIFO pattern.

> **Warning:** Adding prioritized jobs is a slower operation than the other types of jobs, with a complexity `O(log(n))` relative to the number of jobs in the prioritized set in the queue.

Note that prioritized jobs use values from `1` to `2 097 151`, where a lower number is always a **higher** priority than higher numbers. A `priority` of `0` means no priority, so those jobs are processed before prioritized jobs.

> **Danger:** Jobs without a `priority` assigned will get the highest priority, being processed before jobs with priorities assigned to them.

**TypeScript**

```typescript
import { Queue } from 'bullmq';

const myQueue = new Queue('Paint');

await myQueue.add('wall', { color: 'pink' }, { priority: 10 });
await myQueue.add('wall', { color: 'brown' }, { priority: 5 });
await myQueue.add('wall', { color: 'blue' }, { priority: 7 });

// The wall will be painted first brown, then blue and
// finally pink.
```

**Python**

```python
from bullmq import Queue

queue = Queue('Paint')

await queue.add('wall', {'color': 'pink'}, {'priority': 10})
await queue.add('wall', {'color': 'brown'}, {'priority': 5})
await queue.add('wall', {'color': 'blue'}, {'priority': 7})

# The wall will be painted first brown, then blue and
# finally pink.
```

**Elixir**

```elixir
BullMQ.Queue.add("Paint", "wall", %{color: "pink"}, connection: :my_redis, priority: 10)
BullMQ.Queue.add("Paint", "wall", %{color: "brown"}, connection: :my_redis, priority: 5)
BullMQ.Queue.add("Paint", "wall", %{color: "blue"}, connection: :my_redis, priority: 7)

# The wall will be painted first brown, then blue and
# finally pink.
```

**.NET**

```csharp
using BullMQ;

await using var queue = new Queue("Paint", new QueueOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});

await queue.AddAsync("wall", new { color = "pink" }, new JobsOptions { Priority = 10 });
await queue.AddAsync("wall", new { color = "brown" }, new JobsOptions { Priority = 5 });
await queue.AddAsync("wall", new { color = "blue" }, new JobsOptions { Priority = 7 });

// The wall will be painted first brown, then blue and
// finally pink.
```

**Rust**

```rust
use bullmq::Queue;

let queue = Queue::new("Paint").await?;

queue.add("wall", serde_json::json!({ "color": "pink" })).priority(10).await?;
queue.add("wall", serde_json::json!({ "color": "brown" })).priority(5).await?;
queue.add("wall", serde_json::json!({ "color": "blue" })).priority(7).await?;

// The wall will be painted first brown, then blue and
// finally pink.
```

**PHP**

```php
<?php

use BullMQ\Queue;

$queue = new Queue('Paint');

$queue->add('wall', ['color' => 'pink'], ['priority' => 10]);
$queue->add('wall', ['color' => 'brown'], ['priority' => 5]);
$queue->add('wall', ['color' => 'blue'], ['priority' => 7]);

// The wall will be painted first brown, then blue and
// finally pink.
```

If several jobs are added with the same priority value, then the jobs within that priority will be processed in [FIFO (_First in, first out_)](https://docs.bullmq.io/guide/jobs/fifo.md) fashion.

## Change priority

If you want to change the `priority` after inserting a job, use the **`changePriority`** method. For example, let's say that you want to change the `priority` from `16` to `1`:

**TypeScript**

```typescript
const job = await Job.create(queue, 'test2', { foo: 'bar' }, { priority: 16 });

await job.changePriority({
  priority: 1,
});
```

**Python**

```python
job = await queue.add('test2', {'foo': 'bar'}, {'priority': 16})

await job.changePriority({
    'priority': 1,
})
```

**.NET**

```csharp
var job = await queue.AddAsync("test2", new { foo = "bar" }, new JobsOptions { Priority = 16 });

await job.ChangePriorityAsync(priority: 1);
```

**Rust**

```rust
let job = queue
    .add("test2", serde_json::json!({ "foo": "bar" }))
    .priority(16)
    .await?;

job.change_priority(1, false).await?;
```

or if you want to use the [LIFO (_Last In, First Out_)](https://docs.bullmq.io/guide/jobs/lifo.md) option:

**TypeScript**

```typescript
const job = await Job.create(queue, 'test2', { foo: 'bar' }, { priority: 16 });

await job.changePriority({
  lifo: true,
});
```

**Python**

```python
job = await queue.add('test2', {'foo': 'bar'}, {'priority': 16})

await job.changePriority({
    'lifo': True,
})
```

**.NET**

```csharp
var job = await queue.AddAsync("test2", new { foo = "bar" }, new JobsOptions { Priority = 16 });

await job.ChangePriorityAsync(lifo: true);
```

**Rust**

```rust
let job = queue
    .add("test2", serde_json::json!({ "foo": "bar" }))
    .priority(16)
    .await?;

job.change_priority(0, true).await?;
```

## Get Prioritized jobs

As prioritized is a new state. You must use **`getJobs`** or **`getPrioritized`** method as:

**TypeScript**

```typescript
const jobs = await queue.getJobs(['prioritized']);

const jobs2 = await queue.getPrioritized();
```

**Python**

```python
jobs = await queue.getJobs(['prioritized'])

jobs2 = await queue.getPrioritized()
```

**Elixir**

```elixir
{:ok, jobs} = BullMQ.Queue.get_jobs("Paint", [:prioritized], connection: :my_redis)

{:ok, jobs2} = BullMQ.Queue.get_prioritized("Paint", connection: :my_redis)
```

**.NET**

```csharp
var jobs = await queue.GetJobsAsync(new[] { "prioritized" });
```

**Rust**

```rust
let jobs = queue.get_jobs(&["prioritized"], 0, -1, false).await?;

let jobs2 = queue.get_prioritized(0, -1).await?;
```

**PHP**

```php
$jobs = $queue->getJobsByType(['prioritized']);

$jobs2 = $queue->getPrioritized();
```

## Get Counts per Priority

If you want to get the `count` of jobs in `prioritized` status (priorities higher than 0) or in `waiting` status (priority 0), use the **`getCountsPerPriority`** method. For example, let's say that you want to get counts for `priority` `1` and `0`:

**TypeScript**

```typescript
const counts = await queue.getCountsPerPriority([1, 0]);
/*
{
  '1': 11,
  '0': 10
}
*/
```

**Python**

```python
counts = await queue.getCountsPerPriority([1, 0])
"""
{
  '1': 11,
  '0': 10
}
"""
```

**Elixir**

```elixir
{:ok, counts} = BullMQ.Queue.get_counts_per_priority("Paint", [1, 0], connection: :my_redis)
# %{1 => 11, 0 => 10}
```

**.NET**

```csharp
var counts = await queue.GetCountsPerPriorityAsync(new long[] { 1, 0 });
// [11, 10]
```

**Rust**

```rust
let counts = queue.get_counts_per_priority(&[1, 0]).await?;
// {1: 11, 0: 10}
```

**PHP**

```php
$counts = $queue->getCountsPerPriority([1, 0]);
/*
[
  1 => 11,
  0 => 10
]
*/
```

## Read more:

- 📋 [Faster Priority jobs](https://bullmq.io/news/062123/faster-priority-jobs/)
- 💡 [Change Priority API Reference](https://docs.bullmq.io/api/classes/v6.Job.html#changepriority)
- 💡 [Get Prioritized API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#getprioritized)
- 💡 [Get Counts per Priority API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#getcountsperpriority)
