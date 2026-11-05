# Graceful shutdown

BullMQ supports graceful shutdowns of workers. This is important so that we can minimize stalled jobs when a worker for some reason must be shutdown. But note that even in the event of a "ungraceful shutdown", the stalled mechanism in BullMQ allows for new workers to pick up stalled jobs and continue working on them.

{% hint style="danger" %}
Prior to BullMQ 2.0, in order for stalled jobs to be picked up by other workers you need to have a [`QueueScheduler`](../queuescheduler.md) class running in the system.

From BullMQ 2.0 and onwards, the `QueueScheduler` is not needed anymore, so the information above is only valid for older versions.
{% endhint %}

In order to perform a shutdown just call the _**`close`**_ method:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
await worker.close();
```

{% endtab %}

{% tab title="Python" %}

```python
await worker.close()
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
:ok = BullMQ.Worker.close(worker)
```

{% endtab %}

{% tab title=".NET" %}

```csharp
await worker.CloseAsync();
```

{% endtab %}

{% tab title="Rust" %}

```rust
worker.close(30_000).await?;
```

{% endtab %}
{% endtabs %}

The shutdown behavior and timeout depend on the SDK. TypeScript, Python, and .NET wait for active jobs to finish without a built-in timeout. Rust's `close(30_000)` waits for up to 30 seconds and aborts unfinished processing when the deadline expires. Elixir waits up to 30 seconds by default; pass `timeout: milliseconds` to choose another deadline, or `force: true` to skip waiting. If shutdown ends before active jobs finish, they can be recovered as stalled by other workers (when stalled-job checking is configured).
