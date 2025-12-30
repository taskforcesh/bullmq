Currently we have 3 available methods in queue class:

# Drain

Removes all jobs that are waiting or delayed, but not active, waiting-children, completed or failed.

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

await queue.drain();
```

{% hint style="warning" %}
Parent jobs that belong to the queue being drained will be kept in **waiting-children** status if they have pending children, but if they do not have any pending children they will just be removed.
{% endhint %}

{% hint style="warning" %}
Parent jobs in queues different from the one being drained will either stay in **waiting-children** if they
have pending children in other queues, or just moved to wait.
{% endhint %}

# Clean

Removes jobs in a specific state, but keeps jobs within a certain grace period.

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

const deletedJobIds = await queue.clean(
  60000, // 1 minute
  1000, // max number of jobs to clean
  'paused',
);
```

# Obliterate

Completely obliterates a queue and all of its contents.

{% tabs %}
{% tab title="TypeScript" %}
```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

await queue.obliterate();
```
{% endtab %}

{% tab title="Python" %}
```python
import asyncio
from bullmq import Queue

async def main():
    queue = Queue('paint')
    
    await queue.obliterate()
    await queue.close()

asyncio.run(main())
```
{% endtab %}

{% tab title="Elixir" %}
```elixir
alias BullMQ.Queue

:ok = Queue.obliterate("paint", connection: :redis)
```
{% endtab %}

{% tab title="PHP" %}
```php
<?php
use BullMQ\Queue;

$queue = new Queue('paint');

$queue->obliterate();

$queue->close();
?>
```
{% endtab %}
{% endtabs %}

For more advanced scenarios where you need to force obliteration even with active jobs:

{% tabs %}
{% tab title="TypeScript" %}
```typescript
import { Queue } from 'bullmq';

const queue = new Queue('paint');

// Force obliteration even with active jobs
await queue.obliterate({ force: true });
```
{% endtab %}

{% tab title="Python" %}
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
{% endtab %}

{% tab title="Elixir" %}
```elixir
alias BullMQ.Queue

# Force obliteration even with active jobs
:ok = Queue.obliterate("paint", force: true, connection: :redis)
```
{% endtab %}

{% tab title="PHP" %}
```php
<?php
use BullMQ\Queue;

$queue = new Queue('paint');

// Force obliteration even with active jobs
$queue->obliterate(['force' => true]);

$queue->close();
?>
```
{% endtab %}
{% endtabs %}

{% hint style="warning" %}
Parent jobs in queues different from the one being obliterated will either stay in **waiting-children** if they
have pending children in other queues, or just moved to wait.
{% endhint %}

## Read more:

- 💡 [Drain API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#drain)
- 💡 [Clean API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#clean)
- 💡 [Obliterate API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#obliterate)
