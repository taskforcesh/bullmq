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
    startDate: new Date('2024-10-15T00:00:00Z'), // start on October 15, 2024
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
from bullmq import Queue

connection = {"host": "localhost", "port": 6379}
my_queue = Queue("my-dated-jobs", {"connection": connection})

await my_queue.upsertJobScheduler(
    "start-later-job",
    {
        "every": 60000,  # every minute
        "startDate": "2024-10-15T00:00:00Z",  # start on October 15, 2024
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
      # start on October 15, 2024
      start_date: ~U[2024-10-15 00:00:00Z]
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
        StartDate = "2024-10-15T00:00:00Z", // start on October 15, 2024
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

let connection = RedisConnectionOptions {
    host: Some("localhost".into()),
    port: Some(6379),
    ..Default::default()
};
let my_queue =
    Queue::with_options("my-dated-jobs", QueueOptions::new().connection(connection)).await?;

my_queue
    .upsert_job_scheduler(
        "start-later-job",
        RepeatOptions {
            every: Some(60000),                // every minute
            start_date: Some(1728950400000), // start on October 15, 2024 (Unix ms)
            ..Default::default()
        },
        Some("timed-start-job"),
        Some(serde_json::json!({ "message": "Starting later" })),
        None,
    )
    .await?;
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
    endDate: new Date('2024-11-01T00:00:00Z'), // end on November 1, 2024
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
        "endDate": "2024-11-01T00:00:00Z",  # end on November 1, 2024
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
      # end on November 1, 2024
      end_date: ~U[2024-11-01 00:00:00Z]
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
        EndDate = "2024-11-01T00:00:00Z", // end on November 1, 2024
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
my_queue
    .upsert_job_scheduler(
        "end-soon-job",
        RepeatOptions {
            every: Some(60000),              // every minute
            end_date: Some(1730419200000), // end on November 1, 2024 (Unix ms)
            ..Default::default()
        },
        Some("timed-end-job"),
        Some(serde_json::json!({ "message": "Ending soon" })),
        None,
    )
    .await?;
```

{% endtab %}
{% endtabs %}

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
{% endtabs %}

#### immediately

This setting forces the job to execute as soon as it is added, regardless of the schedule. This can help in situations where an immediate action is required before entering a regular cycle.

When you use the every option in BullMQ, it schedules jobs based on fixed time intervals, which might seem a bit counterintuitive initially. For instance, if you set an interval of 2000ms, jobs will be triggered at every even second—such as 0, 2, 4, 6, 8 seconds, and so on. This means the scheduling aligns with the clock, regardless of when you actually added the job.

If you need a job to begin processing immediately after you add a job scheduler, regardless of the interval’s alignment with the clock, you can use the immediately setting. This is especially crucial for long intervals. For example, if you set the job to repeat monthly, normally it would wait to start until the first second of the next month. If you add the job mid-month, it would not start until the beginning of the following month. Using immediately ensures the first instance of the job runs as soon as it’s added, bypassing the wait until the scheduled interval begins.

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
{% endtabs %}

{% hint style="danger" %}
From version 5.19.0 and onwards the "immediately" option has been deprecated. The current behaviour is as if "immediately" was always true, in other words, the first repetition will always be immediately for a new inserted job scheduler, and then repeat according to the "every" setting. Subsequent calls to upsertJobScheduler for **existing** schedulers will not lead to immediate repetitions and will instead follow the "every" interval.
{% endhint %}
