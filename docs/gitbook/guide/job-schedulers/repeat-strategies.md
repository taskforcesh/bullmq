# Repeat Strategies

BullMQ comes with two predefined strategies for creating repeatable jobs. The ‘every’ strategy is straightforward, allowing you to schedule jobs to repeat at specific intervals, measured in seconds. The more complex ‘cron’ strategy uses cron expressions, as defined by the [cron-parser](https://www.npmjs.com/package/cron-parser) to schedule jobs in intricate patterns. Additionally, BullMQ lets you create custom strategies, giving you the flexibility to define your own logic for setting job intervals.

### "Every" strategy

The every strategy is used when we simply want to produce repeatable jobs at specific intervals:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const { Queue, Worker } = require('bullmq');

const connection = {
  host: 'localhost',
  port: 6379,
};

const myQueue = new Queue('my-repeatable-jobs', { connection });

// Upserting a repeatable job in the queue
await myQueue.upsertJobScheduler(
  'repeat-every-10s',
  {
    every: 10000, // Job will repeat every 10000 milliseconds (10 seconds)
  },
  {
    name: 'every-job',
    data: { jobData: 'data' },
    opts: {}, // Optional additional job options
  },
);

// Worker to process the jobs
const worker = new Worker(
  'my-repeatable-jobs',
  async job => {
    console.log(`Processing job ${job.id} with data: ${job.data.jobData}`);
  },
  { connection },
);
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Queue, Worker

connection = {
    "host": "localhost",
    "port": 6379,
}

my_queue = Queue("my-repeatable-jobs", {"connection": connection})

# Upserting a repeatable job in the queue
await my_queue.upsertJobScheduler(
    "repeat-every-10s",
    {
        "every": 10000,  # Job will repeat every 10000 milliseconds (10 seconds)
    },
    job_name="every-job",
    job_data={"jobData": "data"},
    opts={},  # Optional additional job options
)

# Worker to process the jobs
async def process(job, token):
    print(f"Processing job {job.id} with data: {job.data['jobData']}")

worker = Worker("my-repeatable-jobs", process, {"connection": connection})
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, _} = BullMQ.RedisConnection.start_link(name: :my_redis, host: "localhost", port: 6379)

# Upserting a repeatable job in the queue
{:ok, _job} =
  BullMQ.JobScheduler.upsert(
    :my_redis,
    "my-repeatable-jobs",
    "repeat-every-10s",
    # Job will repeat every 10000 milliseconds (10 seconds)
    %{every: 10000},
    "every-job",
    %{jobData: "data"},
    # Optional additional job options
    []
  )

# Worker to process the jobs
{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: "my-repeatable-jobs",
    connection: :my_redis,
    processor: fn job ->
      IO.puts("Processing job #{job.id} with data: #{job.data["jobData"]}")
      :ok
    end
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using System.Text.Json;
using BullMQ;

var connection = ConnectionOptions.FromString("localhost:6379");

var myQueue = new Queue("my-repeatable-jobs", new QueueOptions { Connection = connection });

// Upserting a repeatable job in the queue
await myQueue.UpsertJobSchedulerAsync(
    "repeat-every-10s",
    new RepeatOptions
    {
        Every = 10000, // Job will repeat every 10000 milliseconds (10 seconds)
    },
    new JobSchedulerTemplate
    {
        Name = "every-job",
        Data = new { jobData = "data" },
        Opts = new JobsOptions(), // Optional additional job options
    });

// Worker to process the jobs
var worker = new Worker(
    "my-repeatable-jobs",
    (job, _) =>
    {
        var data = (JsonElement)job.Data!;
        Console.WriteLine($"Processing job {job.Id} with data: {data.GetProperty("jobData")}");
        return Task.FromResult<object?>(null);
    },
    new WorkerOptions { Connection = connection });
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::job_scheduler::RepeatOptions;
use bullmq::options::RedisConnectionOptions;
use bullmq::worker::CancellationToken;
use bullmq::{Job, JobOptions, Queue, QueueOptions, Worker, WorkerOptions};

let connection = RedisConnectionOptions {
    host: Some("localhost".into()),
    port: Some(6379),
    ..Default::default()
};

let my_queue = Queue::with_options(
    "my-repeatable-jobs",
    QueueOptions::new().connection(connection.clone()),
)
.await?;

// Upserting a repeatable job in the queue
my_queue
    .upsert_job_scheduler(
        "repeat-every-10s",
        RepeatOptions {
            every: Some(10000), // Job will repeat every 10000 milliseconds (10 seconds)
            ..Default::default()
        },
        Some("every-job"),
        Some(serde_json::json!({ "jobData": "data" })),
        Some(JobOptions::new()), // Optional additional job options
    )
    .await?;

// Worker to process the jobs
let worker = Worker::with_options(
    "my-repeatable-jobs",
    |job: Job, _token: CancellationToken| async move {
        println!("Processing job {} with data: {}", job.id(), job.data()["jobData"]);
        Ok(serde_json::Value::Null)
    },
    WorkerOptions::new().connection(connection),
)
.await?;
```

{% endtab %}
{% endtabs %}

### "Cron" strategy

The “cron” strategy in BullMQ leverages the [cron-parser](https://www.npmjs.com/package/cron-parser) library to use cron expressions for scheduling jobs with greater specificity. This approach is ideal for jobs requiring execution at precise times or intervals, such as automated reports or maintenance tasks.

Below is the supported format for cron expressions in cron-parser:

```
*    *    *    *    *    *
┬    ┬    ┬    ┬    ┬    ┬
│    │    │    │    │    │
│    │    │    │    │    └ day of week (0 - 7, 1L - 7L, where 0 or 7 is Sunday)
│    │    │    │    └───── month (1 - 12)
│    │    │    └────────── day of month (1 - 31, L for the last day of the month)
│    │    └─────────────── hour (0 - 23)
│    └──────────────────── minute (0 - 59)
└───────────────────────── second (0 - 59, optional)
```

This format includes the optional second field, which is not typically available in standard cron schedules, allowing for even more precise scheduling.

Cron expressions are quite powerful as in they support seamless handling timezone differences and daylight saving time transitions, crucial for tasks that depend on local times. And also because of the use of special characters to denote specific days or things like the last day of the month, providing flexibility for monthly and weekly tasks.

If you are new to Cron expressions, [Wikipedia](https://en.wikipedia.org/wiki/Cron) is an excellent starting point to learn how to use them.

Here follows an example that sets up a job to execute at 9:00 AM from Monday to Friday:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const { Queue, Worker } = require('bullmq');

const connection = {
  host: 'localhost',
  port: 6379,
};

const myQueue = new Queue('my-cron-jobs', { connection });

// Upserting a job with a cron expression
await myQueue.upsertJobScheduler(
  'weekday-morning-job',
  {
    pattern: '0 0 9 * * 1-5', // Runs at 9:00 AM every Monday to Friday
  },
  {
    name: 'cron-job',
    data: { jobData: 'morning data' },
    opts: {}, // Optional additional job options
  },
);

// Worker to process the jobs
const worker = new Worker(
  'my-cron-jobs',
  async job => {
    console.log(
      `Processing job ${job.id} at ${new Date()} with data: ${
        job.data.jobData
      }`,
    );
  },
  { connection },
);
```

{% endtab %}

{% tab title="Python" %}

```python
from datetime import datetime
from bullmq import Queue, Worker

connection = {
    "host": "localhost",
    "port": 6379,
}

my_queue = Queue("my-cron-jobs", {"connection": connection})

# Upserting a job with a cron expression
await my_queue.upsertJobScheduler(
    "weekday-morning-job",
    {
        "pattern": "0 0 9 * * 1-5",  # Runs at 9:00 AM every Monday to Friday
    },
    job_name="cron-job",
    job_data={"jobData": "morning data"},
    opts={},  # Optional additional job options
)

# Worker to process the jobs
async def process(job, token):
    print(f"Processing job {job.id} at {datetime.now()} with data: {job.data['jobData']}")

worker = Worker("my-cron-jobs", process, {"connection": connection})
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, _} = BullMQ.RedisConnection.start_link(name: :my_redis, host: "localhost", port: 6379)

# Upserting a job with a cron expression
# (the Elixir SDK uses standard 5-field cron expressions, without seconds)
{:ok, _job} =
  BullMQ.JobScheduler.upsert(
    :my_redis,
    "my-cron-jobs",
    "weekday-morning-job",
    # Runs at 9:00 AM every Monday to Friday
    %{pattern: "0 9 * * 1-5"},
    "cron-job",
    %{jobData: "morning data"},
    # Optional additional job options
    []
  )

# Worker to process the jobs
{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: "my-cron-jobs",
    connection: :my_redis,
    processor: fn job ->
      IO.puts("Processing job #{job.id} at #{DateTime.utc_now()} with data: #{job.data["jobData"]}")
      :ok
    end
  )
```

{% endtab %}

{% tab title=".NET" %}

```csharp
using System.Text.Json;
using BullMQ;

var connection = ConnectionOptions.FromString("localhost:6379");

var myQueue = new Queue("my-cron-jobs", new QueueOptions { Connection = connection });

// Upserting a job with a cron expression
await myQueue.UpsertJobSchedulerAsync(
    "weekday-morning-job",
    new RepeatOptions
    {
        Pattern = "0 0 9 * * 1-5", // Runs at 9:00 AM every Monday to Friday
    },
    new JobSchedulerTemplate
    {
        Name = "cron-job",
        Data = new { jobData = "morning data" },
        Opts = new JobsOptions(), // Optional additional job options
    });

// Worker to process the jobs
var worker = new Worker(
    "my-cron-jobs",
    (job, _) =>
    {
        var data = (JsonElement)job.Data!;
        Console.WriteLine(
            $"Processing job {job.Id} at {DateTime.Now} with data: {data.GetProperty("jobData")}");
        return Task.FromResult<object?>(null);
    },
    new WorkerOptions { Connection = connection });
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::job_scheduler::RepeatOptions;
use bullmq::options::RedisConnectionOptions;
use bullmq::worker::CancellationToken;
use bullmq::{Job, JobOptions, Queue, QueueOptions, Worker, WorkerOptions};

let connection = RedisConnectionOptions {
    host: Some("localhost".into()),
    port: Some(6379),
    ..Default::default()
};

let my_queue =
    Queue::with_options("my-cron-jobs", QueueOptions::new().connection(connection.clone())).await?;

// Upserting a job with a cron expression
my_queue
    .upsert_job_scheduler(
        "weekday-morning-job",
        RepeatOptions {
            pattern: Some("0 0 9 * * 1-5".into()), // Runs at 9:00 AM every Monday to Friday
            ..Default::default()
        },
        Some("cron-job"),
        Some(serde_json::json!({ "jobData": "morning data" })),
        Some(JobOptions::new()), // Optional additional job options
    )
    .await?;

// Worker to process the jobs
let worker = Worker::with_options(
    "my-cron-jobs",
    |job: Job, _token: CancellationToken| async move {
        println!(
            "Processing job {} at {:?} with data: {}",
            job.id(),
            std::time::SystemTime::now(),
            job.data()["jobData"]
        );
        Ok(serde_json::Value::Null)
    },
    WorkerOptions::new().connection(connection),
)
.await?;
```

{% endtab %}
{% endtabs %}

### Custom Strategy

It is possible to define a different strategy to schedule repeatable jobs. The idea is that the repeat strategy, based on a pattern and the latest job's milliseconds, return the next desired timestamp. Although not used in the following example, you could have different behaviours on your repeat strategies based on the current job's name if you want to. However note that **only** **one** repeatStrategy can be defined for a given queue.

For example we can create a custom one for [RRULE](https://jkbrzt.github.io/rrule/) like this:

```typescript
import { Queue, Worker } from 'bullmq';
import { rrulestr } from 'rrule';

const settings = {
  repeatStrategy: (millis: number, opts: RepeatOptions, _jobName: string) => {
    const currentDate =
      opts.startDate && new Date(opts.startDate) > new Date(millis)
        ? new Date(opts.startDate)
        : new Date(millis);

    const rrule = rrulestr(opts.pattern);

    if (rrule.origOptions.count && !rrule.origOptions.dtstart) {
      throw new Error('DTSTART must be defined to use COUNT with rrule');
    }

    const next_occurrence = rrule.after(currentDate, false);
    return next_occurrence?.getTime();
  },
};

const myQueue = new Queue('Paint', { settings });

// Repeat job every 10 seconds
await myQueue.upsertJobScheduler(
  'collibris',
  {
    pattern: 'RRULE:FREQ=SECONDLY;INTERVAL=10;WKST=MO',
  },
  {
    data: { color: 'green' },
  },
);

// Repeat job every 20 seconds
await myQueue.upsertJobScheduler(
  'pingeons',
  {
    pattern: 'RRULE:FREQ=SECONDLY;INTERVAL=20;WKST=MO',
  },
  {
    data: { color: 'gray' },
  },
);

const worker = new Worker(
  'Paint',
  async () => {
    doSomething();
  },
  { settings },
);
```

{% hint style="danger" %}
As you may have noticed, the repeat strategy setting should be provided in **both** the Queue and Worker classes. The reason we need it in both places is that when we first add the job to the Queue, we need to calculate when the next iteration will occur. After that, the Worker takes over, and we use the settings configured in the Worker.
{% endhint %}
