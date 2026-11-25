# Repeat options

There are some options that can be used on all Job Schedulers, to control some aspects of the repetitions. Lets review them one by one:

#### Start date

This option sets a future date from which the job will start being scheduled. This can be useful for setting up jobs that should begin repeating on a specific day.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const { Queue } = require('bullmq');
const connection = { host: 'localhost', port: 6379 };
const myQueue = new Queue('my-dated-jobs', { connection });

await myQueue.upsertJobScheduler(
  'start-later-job',
  {
    every: 60000, // every minute
    startDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // start in 24 hours
  },
  {
    name: 'timed-start-job',
    data: { message: 'Starting later' },
  },
);
```

{% endtab %}

{% tab title="Python" %}

```python
from datetime import datetime, timedelta, timezone

from bullmq import Queue

connection = {"host": "localhost", "port": 6379}
my_queue = Queue("my-dated-jobs", {"connection": connection})

await my_queue.upsertJobScheduler(
    "start-later-job",
    {
        "every": 60000,  # every minute
        # start in 24 hours
        "startDate": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
    },
    job_name="timed-start-job",
    job_data={"message": "Starting later"},
)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, _} = BullMQ.RedisConnection.start_link(name: :my_redis, host: "localhost", port: 6379)

{:ok, _job} =
  BullMQ.JobScheduler.upsert(
    :my_redis,
    "my-dated-jobs",
    "start-later-job",
    %{
      # every minute
      every: 60000,
      # start in 24 hours
      start_date: DateTime.add(DateTime.utc_now(), 1, :day)
    },
    "timed-start-job",
    %{message: "Starting later"}
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using BullMQ;

var connection = ConnectionOptions.FromString("localhost:6379");
var myQueue = new Queue("my-dated-jobs", new QueueOptions { Connection = connection });

await myQueue.UpsertJobSchedulerAsync(
    "start-later-job",
    new RepeatOptions
    {
        Every = 60000, // every minute
        StartDate = DateTimeOffset.UtcNow.AddDays(1).ToUnixTimeMilliseconds(), // start in 24 hours
    },
    new JobSchedulerTemplate
    {
        Name = "timed-start-job",
        Data = new { message = "Starting later" },
    });
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::job_scheduler::RepeatOptions;
use bullmq::options::RedisConnectionOptions;
use bullmq::{Queue, QueueOptions};
use std::time::{SystemTime, UNIX_EPOCH};

let connection = RedisConnectionOptions {
    host: Some("localhost".into()),
    port: Some(6379),
    ..Default::default()
};
let my_queue =
    Queue::with_options("my-dated-jobs", QueueOptions::new().connection(connection)).await?;

let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64;
my_queue
    .upsert_job_scheduler(
        "start-later-job",
        RepeatOptions {
            every: Some(60000),                          // every minute
            start_date: Some(now + 24 * 60 * 60 * 1000), // start in 24 hours (Unix ms)
            ..Default::default()
        },
        Some("timed-start-job"),
        Some(serde_json::json!({ "message": "Starting later" })),
        None,
    )
    .await?;
```

{% endtab %}

{% tab title="Go" %}

```go
import (
	"log"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
	"github.com/taskforcesh/bullmq-go/redisbackend"
)

backend := redisbackend.New(redisbackend.Options{Addr: "localhost:6379"})
myQueue, err := bullmq.NewQueue("my-dated-jobs", &bullmq.QueueOptions{Backend: backend})
if err != nil {
	log.Fatal(err)
}
defer myQueue.Close()

_, err = myQueue.UpsertJobScheduler(ctx, "start-later-job",
	bullmq.RepeatOptions{
		Every:     60000,                                      // every minute
		StartDate: time.Now().Add(24 * time.Hour).UnixMilli(), // start in 24 hours
	},
	&bullmq.JobTemplate{
		Name: "timed-start-job",
		Data: map[string]string{"message": "Starting later"},
	})
if err != nil {
	log.Fatal(err)
}
```

{% endtab %}
{% endtabs %}

#### End Date

Use this to specify when the job should stop being scheduled, effectively setting an expiration date for the job repetitions.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
await myQueue.upsertJobScheduler(
  'end-soon-job',
  {
    every: 60000, // every minute
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // end in 7 days
  },
  {
    name: 'timed-end-job',
    data: { message: 'Ending soon' },
  },
);
```

{% endtab %}

{% tab title="Python" %}

```python
await my_queue.upsertJobScheduler(
    "end-soon-job",
    {
        "every": 60000,  # every minute
        # end in 7 days
        "endDate": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(),
    },
    job_name="timed-end-job",
    job_data={"message": "Ending soon"},
)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, _job} =
  BullMQ.JobScheduler.upsert(
    :my_redis,
    "my-dated-jobs",
    "end-soon-job",
    %{
      # every minute
      every: 60000,
      # end in 7 days
      end_date: DateTime.add(DateTime.utc_now(), 7, :day)
    },
    "timed-end-job",
    %{message: "Ending soon"}
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
await myQueue.UpsertJobSchedulerAsync(
    "end-soon-job",
    new RepeatOptions
    {
        Every = 60000, // every minute
        EndDate = DateTimeOffset.UtcNow.AddDays(7).ToUnixTimeMilliseconds(), // end in 7 days
    },
    new JobSchedulerTemplate
    {
        Name = "timed-end-job",
        Data = new { message = "Ending soon" },
    });
```

{% endtab %}

{% tab title="Rust" %}

```rust
let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64;
my_queue
    .upsert_job_scheduler(
        "end-soon-job",
        RepeatOptions {
            every: Some(60000),                            // every minute
            end_date: Some(now + 7 * 24 * 60 * 60 * 1000), // end in 7 days (Unix ms)
            ..Default::default()
        },
        Some("timed-end-job"),
        Some(serde_json::json!({ "message": "Ending soon" })),
        None,
    )
    .await?;
```

{% endtab %}

{% tab title="Go" %}

```go
_, err = myQueue.UpsertJobScheduler(ctx, "end-soon-job",
	bullmq.RepeatOptions{
		Every:   60000,                                          // every minute
		EndDate: time.Now().Add(7 * 24 * time.Hour).UnixMilli(), // end in 7 days
	},
	&bullmq.JobTemplate{
		Name: "timed-end-job",
		Data: map[string]string{"message": "Ending soon"},
	})
if err != nil {
	log.Fatal(err)
}
```

{% endtab %}
{% endtabs %}

{% hint style="warning" %}
An `every` scheduler compares `endDate` with the current time when it schedules its next job, not with that job's due time. So it can still produce one job due after `endDate`, up to one interval later ([#5190](https://github.com/taskforcesh/bullmq/issues/5190)). The Go SDK compares the due time instead, and produces no such job.
{% endhint %}

#### Timezone (`tz`)

Use `tz` to evaluate cron patterns in a specific timezone.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
await myQueue.upsertJobScheduler(
  'utc-cron-job',
  {
    pattern: '0 15 3 * * *',
    tz: 'UTC',
  },
  {
    name: 'utc-execution-job',
    data: { message: 'Runs at 03:15 UTC' },
  },
);
```

{% endtab %}

{% tab title="Python" %}

```python
await my_queue.upsertJobScheduler(
    "utc-cron-job",
    {
        "pattern": "0 15 3 * * *",
        "tz": "UTC",
    },
    job_name="utc-execution-job",
    job_data={"message": "Runs at 03:15 UTC"},
)
```

{% endtab %}

{% tab title=".NET" %}

```csharp
await myQueue.UpsertJobSchedulerAsync(
    "utc-cron-job",
    new RepeatOptions
    {
        Pattern = "0 15 3 * * *",
        Tz = "UTC",
    },
    new JobSchedulerTemplate
    {
        Name = "utc-execution-job",
        Data = new { message = "Runs at 03:15 UTC" },
    });
```

{% endtab %}

{% tab title="Rust" %}

```rust
my_queue
    .upsert_job_scheduler(
        "utc-cron-job",
        RepeatOptions {
            pattern: Some("0 15 3 * * *".into()),
            tz: Some("UTC".into()),
            ..Default::default()
        },
        Some("utc-execution-job"),
        Some(serde_json::json!({ "message": "Runs at 03:15 UTC" })),
        None,
    )
    .await?;
```

{% endtab %}

{% tab title="Go" %}

```go
_, err = myQueue.UpsertJobScheduler(ctx, "utc-cron-job",
	bullmq.RepeatOptions{
		Pattern: "0 15 3 * * *",
		Tz:      "UTC",
	},
	&bullmq.JobTemplate{
		Name: "utc-execution-job",
		Data: map[string]string{"message": "Runs at 03:15 UTC"},
	})
if err != nil {
	log.Fatal(err)
}
```

{% endtab %}
{% endtabs %}

{% hint style="info" %}
If you previously used `repeat.utc`, replace it with `tz: 'UTC'`.
{% endhint %}

#### Limit

This setting is used to limit the number of times a job will be repeated. When the count reaches this limit, no more jobs will be produced for the given job scheduler.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
await myQueue.upsertJobScheduler(
  'limited-job',
  {
    every: 10000, // every 10 seconds
    limit: 10, // limit to 10 executions
  },
  {
    name: 'limited-execution-job',
    data: { message: 'Limited runs' },
  },
);
```

{% endtab %}

{% tab title="Python" %}

```python
await my_queue.upsertJobScheduler(
    "limited-job",
    {
        "every": 10000,  # every 10 seconds
        "limit": 10,  # limit to 10 executions
    },
    job_name="limited-execution-job",
    job_data={"message": "Limited runs"},
)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, _job} =
  BullMQ.JobScheduler.upsert(
    :my_redis,
    "my-dated-jobs",
    "limited-job",
    %{
      # every 10 seconds
      every: 10000,
      # limit to 10 executions
      limit: 10
    },
    "limited-execution-job",
    %{message: "Limited runs"}
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
await myQueue.UpsertJobSchedulerAsync(
    "limited-job",
    new RepeatOptions
    {
        Every = 10000, // every 10 seconds
        Limit = 10, // limit to 10 executions
    },
    new JobSchedulerTemplate
    {
        Name = "limited-execution-job",
        Data = new { message = "Limited runs" },
    });
```

{% endtab %}

{% tab title="Rust" %}

```rust
my_queue
    .upsert_job_scheduler(
        "limited-job",
        RepeatOptions {
            every: Some(10000), // every 10 seconds
            limit: Some(10),    // limit to 10 executions
            ..Default::default()
        },
        Some("limited-execution-job"),
        Some(serde_json::json!({ "message": "Limited runs" })),
        None,
    )
    .await?;
```

{% endtab %}

{% tab title="Go" %}

```go
_, err = myQueue.UpsertJobScheduler(ctx, "limited-job",
	bullmq.RepeatOptions{
		Every: 10000, // every 10 seconds
		Limit: 10,    // limit to 10 executions
	},
	&bullmq.JobTemplate{
		Name: "limited-execution-job",
		Data: map[string]string{"message": "Limited runs"},
	})
if err != nil {
	log.Fatal(err)
}
```

{% endtab %}
{% endtabs %}

#### immediately

This setting forces the job to execute as soon as it is added, regardless of the schedule. This can help in situations where an immediate action is required before entering a regular cycle.

When you use the `every` option, the first job is produced as soon as the job scheduler is added (or at its `startDate`), and the following ones one interval apart. For instance, with an interval of 2000ms, a scheduler added at 10:00:00.700 produces jobs due at 10:00:00.700, 10:00:02.700, 10:00:04.700, and so on: the intervals start when you add the scheduler, they are not aligned with the clock. With the `offset` option, the jobs are instead due `offset` milliseconds after each multiple of the interval, starting with the next one.

The immediately setting is useful with `pattern` schedulers, whose first job otherwise waits for the first time matching the pattern. For example, with a pattern that repeats on the first day of each month, a scheduler added mid-month would not produce its first job until the beginning of the following month. Using immediately ensures the first job runs as soon as the scheduler is added; the following ones follow the pattern. `every` schedulers always produce their first job right away, as the hint below explains.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
await myQueue.upsertJobScheduler(
  'immediate-job',
  {
    every: 86400000, // once a day
    immediately: true, // execute the first one immediately
  },
  {
    name: 'instant-job',
    data: { message: 'Immediate start' },
  },
);
```

{% endtab %}

{% tab title="Python" %}

```python
await my_queue.upsertJobScheduler(
    "immediate-job",
    {
        "every": 86400000,  # once a day
        "immediately": True,  # execute the first one immediately
    },
    job_name="instant-job",
    job_data={"message": "Immediate start"},
)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, _job} =
  BullMQ.JobScheduler.upsert(
    :my_redis,
    "my-dated-jobs",
    "immediate-job",
    %{
      # once a day
      every: 86400000,
      # execute the first one immediately
      immediately: true
    },
    "instant-job",
    %{message: "Immediate start"}
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
await myQueue.UpsertJobSchedulerAsync(
    "immediate-job",
    new RepeatOptions
    {
        Every = 86400000, // once a day
        Immediately = true, // execute the first one immediately
    },
    new JobSchedulerTemplate
    {
        Name = "instant-job",
        Data = new { message = "Immediate start" },
    });
```

{% endtab %}

{% tab title="Rust" %}

```rust
my_queue
    .upsert_job_scheduler(
        "immediate-job",
        RepeatOptions {
            every: Some(86400000),   // once a day
            immediately: Some(true), // execute the first one immediately
            ..Default::default()
        },
        Some("instant-job"),
        Some(serde_json::json!({ "message": "Immediate start" })),
        None,
    )
    .await?;
```

{% endtab %}

{% tab title="Go" %}

```go
_, err = myQueue.UpsertJobScheduler(ctx, "immediate-job",
	bullmq.RepeatOptions{
		Every:       86400000, // once a day
		Immediately: true,     // execute the first one immediately
	},
	&bullmq.JobTemplate{
		Name: "instant-job",
		Data: map[string]string{"message": "Immediate start"},
	})
if err != nil {
	log.Fatal(err)
}
```

{% endtab %}
{% endtabs %}

{% hint style="danger" %}
From version 5.19.0 and onwards the "immediately" option has been deprecated. The current behaviour is as if "immediately" was always true, in other words, the first repetition will always be immediately for a new inserted job scheduler, and then repeat according to the "every" setting. Subsequent calls to upsertJobScheduler for **existing** schedulers will not lead to immediate repetitions and will instead follow the "every" interval.
{% endhint %}
