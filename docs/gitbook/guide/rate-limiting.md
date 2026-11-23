# Rate limiting

BullMQ provides queue rate limiting. It is possible to configure workers so that they obey a given rate limiting option:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Worker, QueueScheduler } from 'bullmq';

const worker = new Worker('painter', async job => paintCar(job), {
  limiter: {
    max: 10,
    duration: 1000,
  },
});

const scheduler = new QueueScheduler('painter');
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: "painter",
    connection: :my_redis,
    processor: &paint_car/1,
    limiter: %{max: 10, duration: 1000}
  )
```

{% endtab %}
{% endtabs %}

{% hint style="warning" %}
Jobs that get rate limited will actually stay in the waiting state.
{% endhint %}

{% hint style="danger" %}
From BullMQ 2.0 and onwards, the `QueueScheduler` is not needed anymore.
{% endhint %}

{% hint style="info" %}
The rate limiter is global, so if you have for example 10 workers for one queue with the above settings, still only 10 jobs will be processed by second.
{% endhint %}

### Group keys

{% hint style="danger" %}
From BullMQ 3.0 and onwards, group keys support is removed to improve global rate limit, so the information below is only valid for older versions.
{% endhint %}

It is also possible to define a rate limiter based on group keys, for example you may want to have a rate limiter per _customer_ instead of a global rate limiter for all customers:

```typescript
import { Queue, Worker, QueueScheduler } from 'bullmq';

const queue = new Queue('painter', {
  limiter: {
    groupKey: 'customerId',
  },
});

const worker = new Worker('painter', async job => paintCar(job), {
  limiter: {
    max: 10,
    duration: 1000,
    groupKey: 'customerId',
  },
});

const scheduler = new QueueScheduler('painter');

// jobs will be rate limited by the value of customerId key:
await queue.add('rate limited paint', { customerId: 'my-customer-id' });
```

### Manual rate-limit

Sometimes is useful to rate-limit a queue manually instead of based on some static options. For example, you may have an API that returns `429 Too Many Requests`, and you want to rate-limit the queue based on that response.

For this purpose, you can use the worker method **`rateLimit`** like this:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Worker } from 'bullmq';

const worker = new Worker(
  'myQueue',
  async () => {
    const [isRateLimited, duration] = await doExternalCall();
    if (isRateLimited) {
      await worker.rateLimit(duration);
      // Do not forget to throw this special exception,
      // since we must differentiate this case from a failure
      // in order to move the job to wait again.
      throw Worker.RateLimitError();
    }
  },
  {
    connection,
    limiter: {
      max: 1,
      duration: 500,
    },
  },
);
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, worker} =
  BullMQ.Worker.start_link(
    queue: "myQueue",
    connection: :my_redis,
    limiter: %{max: 1, duration: 500},
    processor: fn job ->
      case do_external_call(job.data) do
        {:rate_limited, duration} ->
          # Sets the queue rate limit for `duration` ms and moves the job
          # back to wait (no attempt consumed, no failed event).
          # Equivalent to:
          #   :ok = BullMQ.Queue.rate_limit("myQueue", duration, connection: :my_redis)
          #   :rate_limited
          {:rate_limit_queue, duration}

        {:ok, result} ->
          {:ok, result}
      end
    end
  )
```

{% endtab %}
{% endtabs %}

{% hint style="warning" %}
Don't forget to pass limiter options into your worker's options as _limiter.max_ is used to determine if we need to execute the rate limit validation.
{% endhint %}

{% hint style="info" %}
In Elixir, the older `{:rate_limit, ms}` processor return only moves the current job to the delayed set (like `{:delay, ms}`) and does not rate limit the queue. Use `{:rate_limit_queue, ms}` or `BullMQ.Queue.rate_limit/3` + `:rate_limited` for the behaviour described here.
{% endhint %}

### Get Queue Rate Limit Ttl

Sometimes is useful to know if our queue is rate limited.

For this purpose, you can use the **`getRateLimitTtl`** method like this:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('myQueue', { connection });
const maxJobs = 100;

const ttl = await queue.getRateLimitTtl(maxJobs);

if (ttl > 0) {
  console.log('Queue is rate limited');
}
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
max_jobs = 100

{:ok, ttl} =
  BullMQ.Queue.get_rate_limit_ttl("myQueue", connection: :my_redis, max_jobs: max_jobs)

if ttl > 0 do
  IO.puts("Queue is rate limited")
end
```

{% endtab %}
{% endtabs %}

### Remove Rate Limit Key

Sometimes is useful to stop a rate limit delay.

For this purpose, you can use the **`removeRateLimitKey`** method like this:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('myQueue', { connection });

await queue.removeRateLimitKey();
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, _removed} = BullMQ.Queue.remove_rate_limit_key("myQueue", connection: :my_redis)
```

{% endtab %}
{% endtabs %}

By removing rate limit key, workers will be able to pick jobs again and your rate limit counter is reset to zero.

## Read more:

- 💡 [Rate Limit API Reference](https://docs.bullmq.io/api/classes/v6.Worker.html#ratelimit)
- 💡 [Get Rate Limit Ttl API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#getratelimitttl)
- 💡 [Remove Rate Limit Key API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#removeratelimitkey)
