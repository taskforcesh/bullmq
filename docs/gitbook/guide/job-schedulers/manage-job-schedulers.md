# Manage Job Schedulers

In BullMQ, managing the lifecycle and inventory of job schedulers is crucial for maintaining efficient and organized background tasks. In addition to the upsertJobScheduler method—which allows for the addition and updating of job schedulers—two other methods play essential roles: removeJobScheduler and getJobSchedulers. These functions enable the removal of schedulers and retrieval of all existing schedulers, respectively, providing comprehensive control over your job scheduling environment.

The scheduler ID passed to `upsertJobScheduler` is returned as the `key` property by `getJobScheduler` and `getJobSchedulers`. Use this `key` when retrieving, updating, or removing a scheduler. It is distinct from the scheduler's `name` and the IDs of the jobs it produces; the optional `id` property on `JobSchedulerJson` is not the scheduler identifier.

#### Remove job scheduler

The **removeJobScheduler** method is designed to delete a specific job scheduler from the queue. This is particularly useful when a scheduled task is no longer needed or if you wish to clean up inactive or obsolete schedulers to optimize resource usage.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
// Remove a job scheduler with ID 'scheduler-123'
const result = await queue.removeJobScheduler('scheduler-123');
console.log(
  result ? 'Scheduler removed successfully' : 'Missing Job Scheduler',
);
```

{% endtab %}

{% tab title="Python" %}

```python
# Remove a job scheduler with ID 'scheduler-123'
# (the Python SDK returns 0 when the scheduler was removed, 1 when it was missing)
result = await queue.removeJobScheduler("scheduler-123")
print(
    "Scheduler removed successfully" if result == 0 else "Missing Job Scheduler"
)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
# Remove a job scheduler with ID 'scheduler-123'
{:ok, result} = BullMQ.JobScheduler.remove(:my_redis, "my-queue", "scheduler-123")

IO.puts(if(result, do: "Scheduler removed successfully", else: "Missing Job Scheduler"))
```

{% endtab %}

{% tab title=".NET" %}

```csharp
// Remove a job scheduler with ID 'scheduler-123'
var result = await queue.RemoveJobSchedulerAsync("scheduler-123");
Console.WriteLine(
    result ? "Scheduler removed successfully" : "Missing Job Scheduler");
```

{% endtab %}

{% tab title="Rust" %}

```rust
// Remove a job scheduler with ID 'scheduler-123'
let result = queue.remove_job_scheduler("scheduler-123").await?;
println!(
    "{}",
    if result { "Scheduler removed successfully" } else { "Missing Job Scheduler" }
);
```

{% endtab %}
{% endtabs %}

The method will return true if there was a Job Scheduler to remove with the given ID, or false if there wasn't any.

#### Get Job Schedulers

The **getJobSchedulers** method retrieves a list of all configured job schedulers within a specified range. This is invaluable for monitoring and managing multiple job schedulers, especially in systems where jobs are dynamically scheduled and require frequent reviews or adjustments.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
// Retrieve the first 10 job schedulers in ascending order of their next execution time
const schedulers = await queue.getJobSchedulers(0, 9, true);
console.log('Current job schedulers:', schedulers);
```

{% endtab %}

{% tab title="Python" %}

```python
# Retrieve the first 10 job schedulers in ascending order of their next execution time
schedulers = await queue.getJobSchedulers(0, 9, True)
print("Current job schedulers:", schedulers)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
# Retrieve the first 10 job schedulers in ascending order of their next execution time
{:ok, schedulers} =
  BullMQ.JobScheduler.list(:my_redis, "my-queue", start: 0, end: 9, asc: true)

IO.inspect(schedulers, label: "Current job schedulers")
```

{% endtab %}

{% tab title=".NET" %}

```csharp
// Retrieve the first 10 job schedulers in ascending order of their next execution time
var schedulers = await queue.GetJobSchedulersAsync(0, 9, true);
Console.WriteLine($"Current job schedulers: {JsonSerializer.Serialize(schedulers)}");
```

{% endtab %}

{% tab title="Rust" %}

```rust
// Retrieve the first 10 job schedulers in ascending order of their next execution time
let schedulers = queue.get_job_schedulers(0, 9, true).await?;
println!("Current job schedulers: {:?}", schedulers);
```

{% endtab %}
{% endtabs %}

For example, to remove a scheduler returned by `getJobSchedulers`, pass its `key` to `removeJobScheduler`:

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const [scheduler] = await queue.getJobSchedulers(0, 0);
if (scheduler) {
  await queue.removeJobScheduler(scheduler.key);
}
```

{% endtab %}

{% tab title="Python" %}

```python
schedulers = await queue.getJobSchedulers(0, 0)
if schedulers:
    await queue.removeJobScheduler(schedulers[0]["key"])
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
case BullMQ.JobScheduler.list(:my_redis, "my-queue", start: 0, end: 0) do
  {:ok, [scheduler | _]} ->
    BullMQ.JobScheduler.remove(:my_redis, "my-queue", scheduler.key)

  _ ->
    :ok
end
```

{% endtab %}

{% tab title=".NET" %}

```csharp
var schedulers = await queue.GetJobSchedulersAsync(0, 0);
if (schedulers.Count > 0)
{
    await queue.RemoveJobSchedulerAsync(schedulers[0].Key);
}
```

{% endtab %}

{% tab title="Rust" %}

```rust
let schedulers = queue.get_job_schedulers(0, 0, false).await?;
if let Some(scheduler) = schedulers.first() {
    queue.remove_job_scheduler(&scheduler.key).await?;
}
```

{% endtab %}
{% endtabs %}

This method can be particularly useful for generating reports or dashboards that provide insights into when jobs are scheduled to run, aiding in system monitoring and troubleshooting.

#### Get Job Scheduler

The **getJobScheduler** method retrieves a job scheduler by id. This is invaluable for inspecting dedicated configurations.

{% tabs %}
{% tab title="TypeScript" %}

```typescript
const scheduler = await queue.getJobScheduler('test');
console.log('Current job scheduler:', scheduler);
```

{% endtab %}

{% tab title="Python" %}

```python
scheduler = await queue.getJobScheduler("test")
print("Current job scheduler:", scheduler)
```

{% endtab %}

{% tab title="Elixir" %}

```elixir
{:ok, scheduler} = BullMQ.JobScheduler.get(:my_redis, "my-queue", "test")
IO.inspect(scheduler, label: "Current job scheduler")
```

{% endtab %}

{% tab title=".NET" %}

```csharp
var scheduler = await queue.GetJobSchedulerAsync("test");
Console.WriteLine($"Current job scheduler: {JsonSerializer.Serialize(scheduler)}");
```

{% endtab %}

{% tab title="Rust" %}

```rust
let scheduler = queue.get_job_scheduler("test").await?;
println!("Current job scheduler: {:?}", scheduler);
```

{% endtab %}
{% endtabs %}

## Read more:

- 💡 [Remove Job Scheduler API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#removejobscheduler)
- 💡 [Get Job Schedulers API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#getjobschedulers)
- 💡 [Get Job Scheduler API Reference](https://docs.bullmq.io/api/classes/v6.Queue.html#getjobscheduler)
