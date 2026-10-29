# Meta

The meta data of any queue can be retrieved in the following way:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue } from 'bullmq';

const { concurrency, max, duration, maxLenEvents, paused, version } =
  await queue.getMeta();
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok,
 %{
   concurrency: concurrency,
   max: max,
   duration: duration,
   max_len_events: max_len_events,
   paused: paused,
   version: version
 }} = BullMQ.Queue.get_meta("my-queue", connection: :my_redis)
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::Queue;

let meta = queue.get_meta().await?;
let (concurrency, max, duration, max_len_events, paused) = (
    meta.concurrency,
    meta.max,
    meta.duration,
    meta.max_len_events,
    meta.paused,
);
```

{% endtab %}
{% endtabs %}

## Read more:

- 💡 [Get Meta API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#getmeta)
- 💡 [Global Concurrency](./global-concurrency.md)
- 💡 [Global Rate Limit](./global-rate-limit.md)
