# Global Rate Limit

The global rate limit config is a queue option that determines how many jobs are allowed to be processed in a specific period of time.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
import { Queue } from 'bullmq';

// 1 job per second
await queue.setGlobalRateLimit(1, 1000);
```

{% endtab %}

{% tab title="Python (Redis only)" %}

```python
from bullmq import Queue

# 1 job per second
await queue.setGlobalRateLimit(1, 1000)
```

{% endtab %}

{% tab title="Rust" %}

```rust
use bullmq::Queue;

// 1 job per second
queue.set_global_rate_limit(1, 1000).await?;
```

{% endtab %}
{% endtabs %}

In order to get these values:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const { max, duration } = await queue.getGlobalRateLimit();
```

{% endtab %}

{% tab title="Python (Redis only)" %}

```python
rate_limit = await queue.getGlobalRateLimit()
max_jobs, duration = rate_limit["max"], rate_limit["duration"]
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, %{max: max, duration: duration}} =
  BullMQ.Queue.get_global_rate_limit("my-queue", connection: :my_redis)
```

{% endtab %}

{% tab title="Rust" %}

```rust
if let Some((max, duration)) = queue.get_global_rate_limit().await? {
    println!("{max} jobs every {duration} ms");
}
```

{% endtab %}
{% endtabs %}

And in order to get current ttl:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const ttl = await queue.getRateLimitTtl();
```

{% endtab %}

{% tab title="Python" %}

```python
ttl = await queue.getRateLimitTtl()
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, ttl} = BullMQ.Queue.get_rate_limit_ttl("my-queue", connection: :my_redis)
```

{% endtab %}

{% tab title=".NET" %}

```csharp
long ttl = await queue.GetRateLimitTtlAsync();
```

{% endtab %}

{% tab title="Rust" %}

```rust
let ttl = queue.get_rate_limit_ttl(None).await?;
```

{% endtab %}

{% tab title="PHP" %}

```php
<?php

$ttl = $queue->getRateLimitTtl();
```

{% endtab %}
{% endtabs %}

{% hint style="info" %}
Note that if you choose a rate limit level in your workers, it won't override the global one.
{% endhint %}

### Remove Global Rate Limit

It can be done using the following method:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
await queue.removeGlobalRateLimit();
```

{% endtab %}

{% tab title="Python (Redis only)" %}

```python
await queue.removeGlobalRateLimit()
```

{% endtab %}

{% tab title="Rust" %}

```rust
queue.remove_global_rate_limit().await?;
```

{% endtab %}
{% endtabs %}

## Read more:

- 💡 [Set Global Rate Limit API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#setglobalratelimit)
- 💡 [Get Global Rate Limit API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#getglobalratelimit)
- 💡 [Get Rate Limit Ttl API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#getratelimitttl)
- 💡 [Remove Global Rate Limit API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#removeglobalratelimit)
