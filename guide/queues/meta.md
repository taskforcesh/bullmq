# Meta

The meta data of any queue can be retrieved in the following way:

**TypeScript**

```typescript
import { Queue } from 'bullmq';

const { concurrency, max, duration, maxLenEvents, paused, version } =
  await queue.getMeta();
```

**Elixir**

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

**Rust**

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

## Read more:

- 💡 [Get Meta API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#getmeta)
- 💡 [Global Concurrency](https://docs.bullmq.io/guide/queues/global-concurrency.md)
- 💡 [Global Rate Limit](https://docs.bullmq.io/guide/queues/global-rate-limit.md)
