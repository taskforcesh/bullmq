# Pausing queues

BullMQ supports pausing queues _globally_ or _locally_. When a queue is paused _globally_ no workers will pick up any jobs from the queue. When you pause a queue, the workers that are currently busy processing a job will continue working on that job until it completes (or fails), and then will keep idling until the queue is unpaused.

Pausing a queue is performed by calling the _**`pause`**_ method on a [queue](https://docs.bullmq.io/api/classes/v6.Queue.html) instance:

**TypeScript**

```typescript
await myQueue.pause();
```

**Python**

```python
await my_queue.pause()
```

**Elixir**

```elixir
:ok = BullMQ.Queue.pause("my-queue", connection: :my_redis)
```

**.NET**

```csharp
await myQueue.PauseAsync();
```

**Rust**

```rust
my_queue.pause().await?;
```

**PHP**

```php
$myQueue->pause();
```

It is also possible to _locally_ pause a given worker instance. This pause works in a similar way as the global pause in the sense that the worker will conclude processing the jobs it has already started but will not process any new ones:

**TypeScript**

```typescript
await myWorker.pause();
```

**Python**

```python
await my_worker.pause()
```

**Elixir**

```elixir
:ok = BullMQ.Worker.pause(my_worker)
```

**Rust**

```rust
my_worker.pause();
```

TypeScript and Python wait for active jobs to complete (or fail) when pausing a worker. Rust and Elixir pause calls return immediately while active jobs continue running. Rust has no `force` option, and Elixir's `force` option currently has no effect.

In TypeScript and Python, pass `true` to return immediately while current jobs continue running:

**TypeScript**

```typescript
await myWorker.pause(true);
```

**Python**

```python
await my_worker.pause(True)
```

## Read more:

- 💡 [Pause Queue API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#pause)
- 💡 [Pause Worker API Reference](https://docs.bullmq.io/api/classes/v6.Worker.html#pause)
