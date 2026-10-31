using System.Collections.Concurrent;
using BullMQ;
using BullMQ.Postgres;
using Xunit;

namespace BullMQ.Tests;

/// <summary>
/// End-to-end tests for <see cref="FlowProducer"/>: a parent job waits for its
/// children to complete before it becomes processable. Runs against both backends.
/// </summary>
public abstract class FlowProducerTestsBase
{
    protected abstract QueueOptions NewQueueOptions();

    protected abstract WorkerOptions NewWorkerOptions();

    private static string UniqueName() => $"dotnet-flow-{Guid.NewGuid():N}";

    [Theory]
    [InlineData("root-parent")]
    [InlineData("nested-parent")]
    [InlineData("replace")]
    [InlineData("active-child")]
    [InlineData("simple-child")]
    [InlineData("reschedule-child")]
    [InlineData("ttl-child")]
    [InlineData("nested-leaf")]
    public async Task Deduplication_InvalidFlowsFailBeforeWrites(string scenario)
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        await using var producer = new FlowProducer(NewQueueOptions());
        var leaf = new FlowJob { Name = "leaf", QueueName = q };
        var root = new FlowJob { Name = "root", QueueName = q, Children = new[] { leaf } };
        if (scenario == "root-parent") root.Opts = new() { Deduplication = new() { Id = "bad" } };
        if (scenario == "nested-parent")
        {
            leaf.Children = new[] { new FlowJob { Name = "grandchild", QueueName = q } };
            leaf.Opts = new() { Deduplication = new() { Id = "bad" } };
        }
        if (scenario == "replace") leaf.Opts = new() { Deduplication = new() { Id = "bad", Replace = false } };
        if (scenario == "active-child") leaf.Opts = new() { Deduplication = new() { Id = "bad", KeepLastIfActive = true } };
        if (scenario == "simple-child") leaf.Opts = new() { Deduplication = new() { Id = "bad" } };
        if (scenario == "reschedule-child") leaf.Opts = new() { Deduplication = new() { Id = "bad", Reschedule = true } };
        if (scenario == "ttl-child") leaf.Opts = new() { Deduplication = new() { Id = "bad", Ttl = 10000, Extend = true } };
        if (scenario == "nested-leaf")
        {
            leaf.Children = new[]
            {
                new FlowJob { Name = "grandchild", QueueName = q, Opts = new() { Deduplication = new() { Id = "bad" } } },
            };
        }
        await Assert.ThrowsAsync<ArgumentException>(() => producer.AddAsync(root));
        Assert.All((await queue.GetJobCountsAsync()).Values, count => Assert.Equal(0, count));
        await queue.ObliterateAsync(force: true);
    }

    [Fact]
    public async Task Deduplication_RootLeavesReturnWinner()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        await using var producer = new FlowProducer(NewQueueOptions());
        try
        {
            var leaf = new FlowJob
            {
                Name = "leaf",
                QueueName = q,
                Opts = new() { Delay = 60000, Deduplication = new() { Id = "leaf", Reschedule = true } },
            };
            var first = await producer.AddAsync(leaf);
            var second = await producer.AddAsync(leaf);
            Assert.Equal(first.Job.Id, second.Job.Id);
            Assert.Equal(1, await queue.GetDelayedCountAsync());
        }
        finally { await queue.ObliterateAsync(force: true); }
    }

    [Fact]
    public async Task Deduplication_ChildCannotReuseStandaloneDelayedWinner()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        await using var producer = new FlowProducer(NewQueueOptions());
        try
        {
            var winner = await queue.AddAsync("standalone", new { original = true },
                new JobsOptions { Delay = 60000, Deduplication = new() { Id = "child" } });
            await Assert.ThrowsAsync<ArgumentException>(() => producer.AddAsync(new FlowJob
            {
                Name = "parent",
                QueueName = q,
                Children = new[]
                {
                    new FlowJob { Name = "child", QueueName = q, Opts = new() { Delay = 1, Deduplication = new() { Id = "child", Reschedule = true } } },
                },
            }));
            Assert.Equal(JobState.Delayed, await winner.GetStateAsync());
            var stored = await queue.GetJobAsync(winner.Id!);
            Assert.Equal(60000, stored!.Delay);
            Assert.Null(stored.Parent);
            Assert.Equal(1, (await queue.GetJobCountsAsync()).Values.Sum());
        }
        finally { await queue.ObliterateAsync(force: true); }
    }

    [Fact]
    public async Task Flow_ParentWaitsForChildren()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        await using var flow = new FlowProducer(NewQueueOptions());

        var completed = new ConcurrentQueue<string>();
        var allDone = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var worker = new Worker(q, (job, _) => Task.FromResult<object?>("ok"), NewWorkerOptions());
        worker.Completed += (job, _) =>
        {
            completed.Enqueue(job.Name);
            if (completed.Count >= 3)
            {
                allDone.TrySetResult(true);
            }
        };

        try
        {
            var tree = await flow.AddAsync(new FlowJob
            {
                Name = "parent",
                QueueName = q,
                Data = new { root = true },
                Children = new[]
                {
                    new FlowJob { Name = "c1", QueueName = q, Data = new { i = 1 } },
                    new FlowJob { Name = "c2", QueueName = q, Data = new { i = 2 } },
                },
            });

            Assert.False(string.IsNullOrEmpty(tree.Job.Id));
            Assert.Equal(2, tree.Children!.Count);

            // The parent waits for its children; the children are ready to run.
            Assert.Equal(JobState.WaitingChildren, await queue.GetJobStateAsync(tree.Job.Id!));
            Assert.Equal(JobState.Waiting, await queue.GetJobStateAsync(tree.Children![0].Job.Id!));

            _ = worker.RunAsync();
            await WaitForAsync(allDone.Task, TimeSpan.FromSeconds(20));

            // All three ran, and the parent ran last (after both children).
            Assert.Equal(3, completed.Count);
            Assert.Equal("parent", completed.Last());
            Assert.Equal(JobState.Completed, await queue.GetJobStateAsync(tree.Job.Id!));
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await flow.CloseAsync();
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Flow_ParentSeesChildrenReturnValues()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        await using var flow = new FlowProducer(NewQueueOptions());

        IReadOnlyDictionary<string, object?>? parentChildValues = null;
        var parentDone = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);

        var worker = new Worker(q, async (job, _) =>
        {
            if (job.Name == "parent")
            {
                parentChildValues = await job.GetChildrenValuesAsync();
                parentDone.TrySetResult(true);
                return "parent-done";
            }

            return job.Name; // each child returns its own name
        }, NewWorkerOptions());

        try
        {
            await flow.AddAsync(new FlowJob
            {
                Name = "parent",
                QueueName = q,
                Data = new { },
                Children = new[]
                {
                    new FlowJob { Name = "c1", QueueName = q, Data = new { } },
                    new FlowJob { Name = "c2", QueueName = q, Data = new { } },
                },
            });

            _ = worker.RunAsync();
            await WaitForAsync(parentDone.Task, TimeSpan.FromSeconds(20));

            Assert.NotNull(parentChildValues);
            Assert.Equal(2, parentChildValues!.Count);
            var combined = string.Concat(parentChildValues.Values.Select(v => v?.ToString()));
            Assert.Contains("c1", combined);
            Assert.Contains("c2", combined);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await flow.CloseAsync();
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Flow_MultiLevel_ProcessesLeafToRoot()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        await using var flow = new FlowProducer(NewQueueOptions());

        var order = new ConcurrentQueue<string>();
        var allDone = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var worker = new Worker(q, (job, _) => Task.FromResult<object?>("ok"), NewWorkerOptions());
        worker.Completed += (job, _) =>
        {
            order.Enqueue(job.Name);
            if (order.Count >= 3)
            {
                allDone.TrySetResult(true);
            }
        };

        try
        {
            await flow.AddAsync(new FlowJob
            {
                Name = "root",
                QueueName = q,
                Children = new[]
                {
                    new FlowJob
                    {
                        Name = "mid",
                        QueueName = q,
                        Children = new[] { new FlowJob { Name = "leaf", QueueName = q } },
                    },
                },
            });

            _ = worker.RunAsync();
            await WaitForAsync(allDone.Task, TimeSpan.FromSeconds(20));

            Assert.Equal(new[] { "leaf", "mid", "root" }, order.ToArray());
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await flow.CloseAsync();
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Flow_SingleRootWithoutChildren_Processes()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        await using var flow = new FlowProducer(NewQueueOptions());

        var done = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var worker = new Worker(q, (job, _) => Task.FromResult<object?>("ok"), NewWorkerOptions());
        worker.Completed += (_, _) => done.TrySetResult(true);

        try
        {
            var tree = await flow.AddAsync(new FlowJob { Name = "solo", QueueName = q, Data = new { } });
            Assert.False(string.IsNullOrEmpty(tree.Job.Id));

            // A childless root is a plain waiting job.
            Assert.Equal(JobState.Waiting, await queue.GetJobStateAsync(tree.Job.Id!));

            _ = worker.RunAsync();
            await WaitForAsync(done.Task, TimeSpan.FromSeconds(15));

            Assert.Equal(JobState.Completed, await queue.GetJobStateAsync(tree.Job.Id!));
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await flow.CloseAsync();
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task Flow_CrossQueue_ParentWaitsForChildInAnotherQueue()
    {
        var qParent = UniqueName();
        var qChild = UniqueName();
        await using var parentQueue = new Queue(qParent, NewQueueOptions());
        await using var childQueue = new Queue(qChild, NewQueueOptions());
        await using var flow = new FlowProducer(NewQueueOptions());

        var parentDone = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var parentWorker = new Worker(qParent, (_, _) => Task.FromResult<object?>("ok"), NewWorkerOptions());
        parentWorker.Completed += (_, _) => parentDone.TrySetResult(true);
        var childWorker = new Worker(qChild, (_, _) => Task.FromResult<object?>("ok"), NewWorkerOptions());

        try
        {
            var tree = await flow.AddAsync(new FlowJob
            {
                Name = "parent",
                QueueName = qParent,
                Children = new[] { new FlowJob { Name = "child", QueueName = qChild } },
            });

            Assert.Equal(JobState.WaitingChildren, await parentQueue.GetJobStateAsync(tree.Job.Id!));

            _ = parentWorker.RunAsync();
            _ = childWorker.RunAsync();
            await WaitForAsync(parentDone.Task, TimeSpan.FromSeconds(20));

            Assert.Equal(JobState.Completed, await parentQueue.GetJobStateAsync(tree.Job.Id!));
        }
        finally
        {
            await parentWorker.CloseAsync(force: true);
            await childWorker.CloseAsync(force: true);
            await flow.CloseAsync();
            await parentQueue.ObliterateAsync(force: true);
            await childQueue.ObliterateAsync(force: true);
        }
    }

    private static async Task<T> WaitForAsync<T>(Task<T> task, TimeSpan timeout)
    {
        var completed = await Task.WhenAny(task, Task.Delay(timeout));
        if (completed != task)
        {
            throw new TimeoutException("Timed out waiting for the expected event.");
        }

        return await task;
    }
}

/// <summary>Runs the flow suite against the Redis backend.</summary>
public sealed class RedisFlowProducerTests : FlowProducerTestsBase
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_REDIS") ?? "localhost:6379";

    protected override QueueOptions NewQueueOptions() =>
        new() { Connection = ConnectionOptions.FromString(ConnectionString) };

    protected override WorkerOptions NewWorkerOptions() =>
        new() { Connection = ConnectionOptions.FromString(ConnectionString), Autorun = false };
}

/// <summary>Runs the flow suite against the PostgreSQL backend.</summary>
public sealed class PostgresFlowProducerTests : FlowProducerTestsBase
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_POSTGRES")
        ?? $"Host=localhost;Database=bullmq_test;Username={Environment.UserName}";

    protected override QueueOptions NewQueueOptions() =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString } };

    protected override WorkerOptions NewWorkerOptions() =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString }, Autorun = false };
}
