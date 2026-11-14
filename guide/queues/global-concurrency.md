# Global Concurrency

The global concurrency factor is a queue option that determines how many jobs are allowed to be processed in parallel across all your worker instances.

**TypeScript**

```typescript
import { Queue } from 'bullmq';

await queue.setGlobalConcurrency(4);
```

**Python (Redis only)**

```python
from bullmq import Queue

await queue.setGlobalConcurrency(4)
```

**Rust**

```rust
use bullmq::Queue;

queue.set_global_concurrency(4).await?;
```

And in order to get this value:

**TypeScript**

```typescript
const globalConcurrency = await queue.getGlobalConcurrency();
```

**Python (Redis only)**

```python
global_concurrency = await queue.getGlobalConcurrency()
```

**Elixir**

```elixir
{:ok, global_concurrency} =
  BullMQ.Queue.get_global_concurrency("my-queue", connection: :my_redis)
```

**Rust**

```rust
let global_concurrency = queue.get_global_concurrency().await?;
```

> **Note:** Note that if you choose a concurrency level in your workers, it will not override the global one, it will just be the maximum jobs a given worker can process in parallel but never more than the global one.

### Remove Global Concurrency

It can be done using the following method:

**TypeScript**

```typescript
await queue.removeGlobalConcurrency();
```

**Python (Redis only)**

```python
await queue.removeGlobalConcurrency()
```

**Rust**

```rust
queue.remove_global_concurrency().await?;
```

## Read more:

- 💡 [Set Global Concurrency API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#setglobalconcurrency)
- 💡 [Get Global Concurrency API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#getglobalconcurrency)
- 💡 [Remove Global Concurrency API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#removeglobalconcurrency)
