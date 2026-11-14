Currently we have 3 available methods in queue class:

# Drain

Removes all jobs that are waiting or delayed, but not active, waiting-children, completed or failed.

**TypeScript**

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

await queue.drain();
```

**Python**

```python
import asyncio
from bullmq import Queue

async def main():
    queue = Queue('paint')

    await queue.drain()
    await queue.close()

asyncio.run(main())
```

**Elixir**

```elixir
alias BullMQ.Queue

:ok = Queue.drain("paint", connection: :redis)
```

**.NET**

```csharp
using BullMQ;

var queue = new Queue("paint", new QueueOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});

await queue.DrainAsync();
```

**Rust**

```rust
use bullmq::Queue;

let queue = Queue::new("paint").await?;

queue.drain(false).await?;
```

**PHP**

```php
<?php
use BullMQ\Queue;

$queue = new Queue('paint');

$queue->drain();

$queue->close();
?>
```

You can also drain delayed jobs by setting the delayed parameter:

**TypeScript**

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

// Also drain delayed jobs
await queue.drain(true);
```

**Python**

```python
import asyncio
from bullmq import Queue

async def main():
    queue = Queue('paint')

    # Also drain delayed jobs
    await queue.drain(delayed=True)
    await queue.close()

asyncio.run(main())
```

**Elixir**

```elixir
alias BullMQ.Queue

# Also drain delayed jobs
:ok = Queue.drain("paint", delayed: true, connection: :redis)
```

**.NET**

```csharp
using BullMQ;

var queue = new Queue("paint", new QueueOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});

// Also drain delayed jobs
await queue.DrainAsync(delayed: true);
```

**Rust**

```rust
use bullmq::Queue;

let queue = Queue::new("paint").await?;

// Also drain delayed jobs
queue.drain(true).await?;
```

**PHP**

```php
<?php
use BullMQ\Queue;

$queue = new Queue('paint');

// Also drain delayed jobs
$queue->drain(true);

$queue->close();
?>
```

> **Warning:** Parent jobs that belong to the queue being drained will be kept in **waiting-children** status if they have pending children, but if they do not have any pending children they will just be removed.

> **Warning:** Parent jobs in queues different from the one being drained will either stay in **waiting-children** if they
> have pending children in other queues, or just moved to wait.

# Clean

Removes jobs in a specific state, but keeps jobs within a certain grace period.

**TypeScript**

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

const deletedJobIds = await queue.clean(
  60000, // 1 minute
  1000, // max number of jobs to clean
  'paused',
);
```

**Python**

```python
import asyncio
from bullmq import Queue

async def main():
    queue = Queue('paint')

    deleted_job_ids = await queue.clean(
        60000,  # 1 minute
        1000,  # max number of jobs to clean
        'paused',
    )
    await queue.close()

asyncio.run(main())
```

**.NET**

```csharp
using BullMQ;

var queue = new Queue("paint", new QueueOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});

var deletedJobIds = await queue.CleanAsync(
    60000, // 1 minute
    1000, // max number of jobs to clean
    "paused");
```

**Rust**

```rust
use bullmq::Queue;

let queue = Queue::new("paint").await?;

let deleted_job_ids = queue
    .clean(
        60000, // 1 minute
        1000,  // max number of jobs to clean
        "paused",
    )
    .await?;
```

**PHP**

```php
<?php
use BullMQ\Queue;

$queue = new Queue('paint');

$deletedJobIds = $queue->clean(
    60000, // 1 minute
    1000, // max number of jobs to clean
    'paused',
);

$queue->close();
?>
```

# Obliterate

Completely obliterates a queue and all of its contents.

**TypeScript**

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

await queue.obliterate();
```

**Python**

```python
import asyncio
from bullmq import Queue

async def main():
    queue = Queue('paint')

    await queue.obliterate()
    await queue.close()

asyncio.run(main())
```

**Elixir**

```elixir
alias BullMQ.Queue

:ok = Queue.obliterate("paint", connection: :redis)
```

**.NET**

```csharp
using BullMQ;

var queue = new Queue("paint", new QueueOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});

await queue.ObliterateAsync();
```

**Rust**

```rust
use bullmq::Queue;

let queue = Queue::new("paint").await?;

queue.obliterate(false, 1000).await?;
```

**PHP**

```php
<?php
use BullMQ\Queue;

$queue = new Queue('paint');

$queue->obliterate();

$queue->close();
?>
```

For more advanced scenarios where you need to force obliteration even with active jobs:

**TypeScript**

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

// Force obliteration even with active jobs
await queue.obliterate({ force: true });
```

**Python**

```python
import asyncio
from bullmq import Queue

async def main():
    queue = Queue('paint')

    # Force obliteration even with active jobs
    await queue.obliterate(force=True)
    await queue.close()

asyncio.run(main())
```

**Elixir**

```elixir
alias BullMQ.Queue

# Force obliteration even with active jobs
:ok = Queue.obliterate("paint", force: true, connection: :redis)
```

**.NET**

```csharp
using BullMQ;

var queue = new Queue("paint", new QueueOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});

// Force obliteration even with active jobs
await queue.ObliterateAsync(force: true);
```

**Rust**

```rust
use bullmq::Queue;

let queue = Queue::new("paint").await?;

// Force obliteration even with active jobs
queue.obliterate(true, 1000).await?;
```

**PHP**

```php
<?php
use BullMQ\Queue;

$queue = new Queue('paint');

// Force obliteration even with active jobs
$queue->obliterate(['force' => true]);

$queue->close();
?>
```

> **Warning:** Parent jobs in queues different from the one being obliterated will either stay in **waiting-children** if they
> have pending children in other queues, or just moved to wait.

## Read more:

- 💡 [Drain API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#drain)
- 💡 [Clean API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#clean)
- 💡 [Obliterate API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#obliterate)
