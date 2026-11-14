# Queues

A Queue is nothing more than a list of jobs waiting to be processed. The jobs can be small, message like, so that the queue can be used as a message broker, or they can be larger long running jobs.

Queues are controlled with the `Queue` class. As all classes in BullMQ, this is a lightweight class with a handful of methods that gives you control over the queue:

**TypeScript**

```typescript
const queue = new Queue('Cars');
```

**Python**

```python
queue = Queue("Cars")
```

**Elixir**

```elixir
{:ok, _pid} = BullMQ.Queue.start_link(name: :cars, queue: "Cars", connection: :my_redis)
```

**.NET**

```csharp
var queue = new Queue("Cars", new QueueOptions
{
    Connection = ConnectionOptions.FromString("localhost:6379"),
});
```

**Rust**

```rust
let queue = Queue::new("Cars").await?;
```

**PHP**

```php
<?php

$queue = new Queue('Cars');
```

> **Note:** See [Connections](https://docs.bullmq.io/guide/connections.md) for details on how to pass Redis details to use by the queue.

When you instantiate a Queue, BullMQ will just _upsert_ a small "meta-key", so if the queue existed before it will just pick it up and you can continue adding jobs to it.

The most important method is probably the [_**add**_](https://docs.bullmq.io/api/classes/v6.Queue.html#add) method. This method allows you to add jobs to the queue in different fashions:

**TypeScript**

```typescript
await queue.add('paint', { color: 'red' });
```

**Python**

```python
await queue.add("paint", {"color": "red"})
```

**Elixir**

```elixir
{:ok, _job} = BullMQ.Queue.add(:cars, "paint", %{color: "red"})
```

**.NET**

```csharp
await queue.AddAsync("paint", new { color = "red" });
```

**Rust**

```rust
queue.add("paint", serde_json::json!({"color": "red"})).await?;
```

**PHP**

```php
<?php

$queue->add('paint', ['color' => 'red']);
```

The code above will add a job named _paint_ to the queue, with payload `{ color: 'red' }`. This job will now be stored in Redis in a list waiting for some worker to pick it up and process it. Workers may not be running when you add the job, however as soon as one worker is connected to the queue it will pick the job and process it.

When adding a job you can also specify an options object. This options object can dramatically change the behaviour of the added jobs. For example you can add a job that is delayed:

**TypeScript**

```typescript
await queue.add('paint', { color: 'blue' }, { delay: 5000 });
```

**Python**

```python
await queue.add("paint", {"color": "blue"}, {"delay": 5000})
```

**Elixir**

```elixir
{:ok, _job} = BullMQ.Queue.add(:cars, "paint", %{color: "blue"}, delay: 5000)
```

**.NET**

```csharp
await queue.AddAsync("paint", new { color = "blue" }, new JobsOptions { Delay = 5000 });
```

**Rust**

```rust
queue
    .add("paint", serde_json::json!({"color": "blue"}))
    .delay(std::time::Duration::from_millis(5000))
    .await?;
```

**PHP**

```php
<?php

$queue->add('paint', ['color' => 'blue'], ['delay' => 5000]);
```

The job will now wait **at** **least** 5 seconds before it is processed.

> **Danger:** Prior to BullMQ 2.0, in order for delay jobs to work you need to have at least one `QueueScheduler` somewhere in your infrastructure. Read more [here](https://docs.bullmq.io/guide/queuescheduler.md).
> 
> From BullMQ 2.0 and onwards, the `QueueScheduler` is not needed anymore.

There are many other options available such as priorities, backoff settings, lifo behaviour, remove-on-complete policies, etc. Please check the remainder of this guide for more information regarding these options.

## Read more:

- 💡 [Queue API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html)
