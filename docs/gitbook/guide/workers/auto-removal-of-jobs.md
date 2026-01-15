# Auto-removal of jobs

By default, when your queue jobs are completed (or failed), they are stored in two special sets, the "completed" and the "failed" set. This is useful so that you can examine the results of your jobs, particularly in the early stages of development. However, as the solution reaches a production-grade level, we usually need to restrict the number of finished jobs to be kept, so that we do not fill Redis with data that is not particularly useful.

BullMQ supports different strategies for auto-removing finalized jobs. These strategies are configured on the Worker's options [`removeOnComplete`](https://api.docs.bullmq.io/interfaces/v5.WorkerOptions.html#removeoncomplete) and [`removeOnFail`](https://api.docs.bullmq.io/interfaces/v5.WorkerOptions.html#removeonfail).

### Remove all finalized jobs

The simplest option is to set `removeOnComplete`/`removeOnFail` to `{count: 0}`, in this case, all jobs will be removed automatically as soon as they are finalized:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const myWorker = new Worker(
  'myQueueName',
  async job => {
    // do some work
  },
  {
    connection,
    removeOnFail: { count: 0 },
  },
);
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Worker

def process_job(job):
    # do some work
    pass

worker = Worker(
    'myQueueName',
    process_job,
    {
        "connection": connection,
        "removeOnFail": {"count": 0},
    },
)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
defmodule MyWorker do
  use BullMQ.Worker

  def process_job(_job) do
    # do some work
    :ok
  end
end

{:ok, worker} = BullMQ.Worker.start_link(
  queue: "myQueueName",
  processor: &MyWorker.process_job/1,
  connection: connection,
  remove_on_fail: %{count: 0}
)
```

{% endtab %}
{% endtabs %}

{% hint style="warning" %}
Jobs will be deleted regardless of their names.
{% endhint %}

### Keep a certain number of jobs

It is also possible to specify a maximum number of jobs to keep. A good practice is to keep a handful of completed jobs and a much larger value of failed jobs:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const myWorker = new Worker(
  'myQueueName',
  async job => {
    // do some work
  },
  {
    connection,
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
);
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Worker

def process_job(job):
    # do some work
    pass

worker = Worker(
    'myQueueName',
    process_job,
    {
        "connection": connection,
        "removeOnComplete": {"count": 1000},
        "removeOnFail": {"count": 5000},
    },
)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
defmodule MyWorker do
  use BullMQ.Worker

  def process_job(_job) do
    # do some work
    :ok
  end
end

{:ok, worker} = BullMQ.Worker.start_link(
  queue: "myQueueName",
  processor: &MyWorker.process_job/1,
  connection: connection,
  remove_on_complete: %{count: 1000},
  remove_on_fail: %{count: 5000}
)
```

{% endtab %}
{% endtabs %}

### Keep jobs based on their age

Another possibility is to keep jobs up to a certain age. The `removeOn` option accepts a [`KeepJobs`](https://api.docs.bullmq.io/interfaces/v5.KeepJobs.html) object, that includes `age`, `count`, and `limit` fields. The `age` is used to specify how old jobs to keep (in seconds), the `count` can be used to limit the total amount to keep, and the `limit` controls how many jobs are removed per cleanup iteration. The `count` option is useful in cases we get an unexpected amount of jobs in a very short time, in this case we may just want to limit to a certain amount to avoid running out of memory. The `limit` option helps control the performance impact of cleanup operations by limiting how many jobs are processed at once.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const myWorker = new Worker(
  'myQueueName',
  async job => {
    // do some work
  },
  {
    connection,
    removeOnComplete: {
      age: 3600, // keep up to 1 hour
      count: 1000, // keep up to 1000 jobs
      limit: 100, // remove up to 100 jobs per cleanup iteration
    },
    removeOnFail: {
      age: 24 * 3600, // keep up to 24 hours
      limit: 50, // remove up to 50 jobs per cleanup iteration
    },
  },
);
```

{% endtab %}

{% tab title="Python" %}

```python
from bullmq import Worker

def process_job(job):
    # do some work
    pass

worker = Worker(
    'myQueueName',
    process_job,
    {
        "connection": connection,
        "removeOnComplete": {
            "age": 3600,  # keep up to 1 hour
            "count": 1000,  # keep up to 1000 jobs
            "limit": 100,  # remove up to 100 jobs per cleanup iteration
        },
        "removeOnFail": {
            "age": 24 * 3600,  # keep up to 24 hours
            "limit": 50,  # remove up to 50 jobs per cleanup iteration
        },
    },
)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
defmodule MyWorker do
  use BullMQ.Worker

  def process_job(_job) do
    # do some work
    :ok
  end
end

{:ok, worker} = BullMQ.Worker.start_link(
  queue: "myQueueName",
  processor: &MyWorker.process_job/1,
  connection: connection,
  remove_on_complete: %{
    age: 3600,    # keep up to 1 hour
    count: 1000,  # keep up to 1000 jobs
    limit: 100    # remove up to 100 jobs per cleanup iteration
  },
  remove_on_fail: %{
    age: 24 * 3600,  # keep up to 24 hours
    limit: 50        # remove up to 50 jobs per cleanup iteration
  }
)
```

{% endtab %}
{% endtabs %}

{% hint style="info" %}
The auto removal of jobs works lazily. This means that jobs are not removed unless a new job completes or fails, since that is when the auto-removal takes place.
{% endhint %}
