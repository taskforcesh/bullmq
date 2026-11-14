# Global Rate Limit

The global rate limit config is a queue option that determines how many jobs are allowed to be processed in a specific period of time.

**TypeScript**

```typescript
import { Queue } from 'bullmq';

// 1 job per second
await queue.setGlobalRateLimit(1, 1000);
```

**Python (Redis only)**

```python
from bullmq import Queue

# 1 job per second
await queue.setGlobalRateLimit(1, 1000)
```

**Rust**

```rust
use bullmq::Queue;

// 1 job per second
queue.set_global_rate_limit(1, 1000).await?;
```

In order to get these values:

**TypeScript**

```typescript
const { max, duration } = await queue.getGlobalRateLimit();
```

**Python (Redis only)**

```python
rate_limit = await queue.getGlobalRateLimit()
max_jobs, duration = rate_limit["max"], rate_limit["duration"]
```

**Elixir**

```elixir
{:ok, %{max: max, duration: duration}} =
  BullMQ.Queue.get_global_rate_limit("my-queue", connection: :my_redis)
```

**Rust**

```rust
if let Some((max, duration)) = queue.get_global_rate_limit().await? {
    println!("{max} jobs every {duration} ms");
}
```

And in order to get current ttl:

**TypeScript**

```typescript
const ttl = await queue.getRateLimitTtl();
```

**Python**

```python
ttl = await queue.getRateLimitTtl()
```

**Elixir**

```elixir
{:ok, ttl} = BullMQ.Queue.get_rate_limit_ttl("my-queue", connection: :my_redis)
```

**.NET**

```csharp
long ttl = await queue.GetRateLimitTtlAsync();
```

**Rust**

```rust
let ttl = queue.get_rate_limit_ttl(None).await?;
```

**PHP**

```php
<?php

$ttl = $queue->getRateLimitTtl();
```

> **Note:** Note that if you choose a rate limit level in your workers, it won't override the global one.

### Remove Global Rate Limit

It can be done using the following method:

**TypeScript**

```typescript
await queue.removeGlobalRateLimit();
```

**Python (Redis only)**

```python
await queue.removeGlobalRateLimit()
```

**Rust**

```rust
queue.remove_global_rate_limit().await?;
```

## Read more:

- 💡 [Set Global Rate Limit API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#setglobalratelimit)
- 💡 [Get Global Rate Limit API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#getglobalratelimit)
- 💡 [Get Rate Limit Ttl API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#getratelimitttl)
- 💡 [Remove Global Rate Limit API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#removeglobalratelimit)
