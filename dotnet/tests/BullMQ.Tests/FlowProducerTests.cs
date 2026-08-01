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
