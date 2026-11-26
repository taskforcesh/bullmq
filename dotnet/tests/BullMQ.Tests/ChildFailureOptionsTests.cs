using System.Collections.Concurrent;
using BullMQ;
using BullMQ.Postgres;
using Xunit;

namespace BullMQ.Tests;

/// <summary>
/// End-to-end tests for the child failure options of a flow
/// (<c>FailParentOnFailure</c>, <c>ContinueParentOnFailure</c>,
/// <c>IgnoreDependencyOnFailure</c>, <c>RemoveDependencyOnFailure</c>) and for
/// <see cref="FlowProducer.GetFlowAsync"/>. Runs against both backends.
/// </summary>
public abstract class ChildFailureOptionsTestsBase
{
    protected abstract QueueOptions NewQueueOptions();

    protected abstract WorkerOptions NewWorkerOptions();

    private static string UniqueName() => $"dotnet-child-failure-{Guid.NewGuid():N}";

    /// <summary>A worker whose processor fails every job named "fail" and completes the rest.</summary>
    private Worker NewFailingChildWorker(string queueName, ConcurrentQueue<string>? processed = null) =>
        new(queueName, (job, _) =>
        {
            processed?.Enqueue(job.Name);
            if (job.Name == "fail")
            {
                throw new InvalidOperationException("child boom");
            }

            return Task.FromResult<object?>($"{job.Name}-done");
        }, NewWorkerOptions());

    [Fact]
    public async Task FailParentOnFailure_FailsParent()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        await using var flow = new FlowProducer(NewQueueOptions());
        var worker = NewFailingChildWorker(q);

        try
        {
            var tree = await flow.AddAsync(new FlowJob
            {
                Name = "parent",
                QueueName = q,
                Children = new[]
                {
                    new FlowJob
                    {
                        Name = "fail",
                        QueueName = q,
                        Opts = new JobsOptions { FailParentOnFailure = true },
                    },
                },
            });

            _ = worker.RunAsync();

            var parentId = tree.Job.Id!;
            await WaitUntilAsync(async () => await queue.GetJobStateAsync(parentId) == JobState.Failed);

            var parent = await queue.GetJobAsync(parentId);
            Assert.NotNull(parent);
            Assert.Contains("child", parent!.FailedReason);
            Assert.Equal(JobState.Failed, await tree.Children![0].Job.GetStateAsync());
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task IgnoreDependencyOnFailure_ParentCompletes_AndExposesIgnoredFailure()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        await using var flow = new FlowProducer(NewQueueOptions());
        var worker = NewFailingChildWorker(q);

        try
        {
            var tree = await flow.AddAsync(new FlowJob
            {
                Name = "parent",
                QueueName = q,
                Children = new[]
                {
                    new FlowJob
                    {
                        Name = "fail",
                        QueueName = q,
                        Opts = new JobsOptions { IgnoreDependencyOnFailure = true },
                    },
                    new FlowJob { Name = "ok", QueueName = q },
                },
            });

            _ = worker.RunAsync();

            var parentId = tree.Job.Id!;
            await WaitUntilAsync(async () => await queue.GetJobStateAsync(parentId) == JobState.Completed);

            var parent = (await queue.GetJobAsync(parentId))!;
            var ignored = await parent.GetIgnoredChildrenFailuresAsync();
            var failedChildId = tree.Children!.Single(c => c.Job.Name == "fail").Job.Id!;
            var entry = Assert.Single(ignored);
            Assert.EndsWith($":{failedChildId}", entry.Key);
            Assert.Equal("child boom", entry.Value);

            var values = await parent.GetChildrenValuesAsync();
            Assert.Single(values);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task IgnoreDependencyOnFailure_WorksForChildAddedWithQueueAddAsync()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        await using var flow = new FlowProducer(NewQueueOptions());
        var worker = NewFailingChildWorker(q);

        try
        {
            // The parent waits for the flow child plus a child added afterwards.
            var tree = await flow.AddAsync(new FlowJob
            {
                Name = "parent",
                QueueName = q,
                Children = new[] { new FlowJob { Name = "ok", QueueName = q } },
            });
            var parentId = tree.Job.Id!;
            var backend = await queue.GetBackendAsync();
            var child = await queue.AddAsync("fail", null, new JobsOptions
            {
                Parent = new ParentOptions { Id = parentId, Queue = backend.QualifiedName },
                IgnoreDependencyOnFailure = true,
            });

            _ = worker.RunAsync();

            await WaitUntilAsync(async () => await queue.GetJobStateAsync(parentId) == JobState.Completed);

            var ignored = await (await queue.GetJobAsync(parentId))!.GetIgnoredChildrenFailuresAsync();
            var entry = Assert.Single(ignored);
            Assert.EndsWith($":{child.Id}", entry.Key);
            Assert.Equal("child boom", entry.Value);
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task RemoveDependencyOnFailure_ParentCompletesWithoutTheChild()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        await using var flow = new FlowProducer(NewQueueOptions());
        var worker = NewFailingChildWorker(q);

        try
        {
            var tree = await flow.AddAsync(new FlowJob
            {
                Name = "parent",
                QueueName = q,
                Children = new[]
                {
                    new FlowJob
                    {
                        Name = "fail",
                        QueueName = q,
                        Opts = new JobsOptions { RemoveDependencyOnFailure = true },
                    },
                    new FlowJob { Name = "ok", QueueName = q },
                },
            });

            _ = worker.RunAsync();

            var parentId = tree.Job.Id!;
            await WaitUntilAsync(async () => await queue.GetJobStateAsync(parentId) == JobState.Completed);

            var parent = (await queue.GetJobAsync(parentId))!;
            Assert.Empty(await parent.GetIgnoredChildrenFailuresAsync());
            Assert.Single(await parent.GetChildrenValuesAsync());

            var failedChild = tree.Children!.Single(c => c.Job.Name == "fail").Job;
            Assert.Equal(JobState.Failed, await failedChild.GetStateAsync());

            // The removed dependency is not part of the tree anymore.
            var node = await flow.GetFlowAsync(new GetFlowOptions { Id = parentId, QueueName = q });
            Assert.Equal(new[] { "ok" }, node!.Children!.Select(c => c.Job.Name));
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task ContinueParentOnFailure_StartsParentBeforeOtherChildrenFinish_AndCanRemoveTheRest()
    {
        var q = UniqueName();
        var pendingQueue = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        await using var pending = new Queue(pendingQueue, NewQueueOptions());
        await using var flow = new FlowProducer(NewQueueOptions());
        var failures = new TaskCompletionSource<Dictionary<string, string>>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var worker = new Worker(q, async (job, _) =>
        {
            if (job.Name == "fail")
            {
                throw new InvalidOperationException("child boom");
            }

            // The parent runs because a child failed: clean up the rest.
            var failed = await job.GetIgnoredChildrenFailuresAsync();
            await job.RemoveUnprocessedChildrenAsync();
            failures.TrySetResult(failed);
            return null;
        }, NewWorkerOptions());

        try
        {
            // The second child lives in a queue without workers, so it never
            // finishes: only cpof can release the parent.
            var tree = await flow.AddAsync(new FlowJob
            {
                Name = "parent",
                QueueName = q,
                Children = new[]
                {
                    new FlowJob
                    {
                        Name = "fail",
                        QueueName = q,
                        Opts = new JobsOptions { ContinueParentOnFailure = true },
                    },
                    new FlowJob { Name = "never", QueueName = pendingQueue },
                },
            });

            Assert.Equal(1, await pending.GetWaitingCountAsync());
            _ = worker.RunAsync();

            await WaitUntilAsync(() => Task.FromResult(failures.Task.IsCompleted));

            var failure = Assert.Single(await failures.Task);
            Assert.EndsWith($":{tree.Children!.Single(c => c.Job.Name == "fail").Job.Id}", failure.Key);
            Assert.Equal("child boom", failure.Value);

            // The child that never ran was removed by the parent.
            Assert.Equal(0, await pending.GetWaitingCountAsync());
        }
        finally
        {
            await worker.CloseAsync(force: true);
            await queue.ObliterateAsync(force: true);
            await pending.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task ChildFailureOptions_AreStoredOnTheJob()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        await using var flow = new FlowProducer(NewQueueOptions());

        try
        {
            var tree = await flow.AddAsync(new FlowJob
            {
                Name = "parent",
                QueueName = q,
                Children = new[]
                {
                    new FlowJob
                    {
                        Name = "child",
                        QueueName = q,
                        Opts = new JobsOptions { FailParentOnFailure = true },
                    },
                },
            });

            var child = (await queue.GetJobAsync(tree.Children![0].Job.Id!))!;
            Assert.True(child.Opts.FailParentOnFailure);
            Assert.Null(child.Opts.IgnoreDependencyOnFailure);
            var parent = Assert.IsAssignableFrom<IReadOnlyDictionary<string, object?>>(child.Parent);
            Assert.Equal(tree.Job.Id, parent["id"]);
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task ConflictingOptions_AreRejectedBeforeAdding()
    {
        var q = UniqueName();
        var defaults = NewQueueOptions();
        defaults.DefaultJobOptions = new JobsOptions { FailParentOnFailure = true };
        await using var queue = new Queue(q, defaults);
        await using var flow = new FlowProducer(NewQueueOptions());

        try
        {
            var parent = new ParentOptions { Id = "parent-1", Queue = $"bull:{q}" };

            // A per-job policy conflicts with the queue's default one
            var conflict = await Assert.ThrowsAsync<ArgumentException>(() => queue.AddAsync(
                "child", null, new JobsOptions { Parent = parent, IgnoreDependencyOnFailure = true }));
            Assert.Contains("failParentOnFailure, ignoreDependencyOnFailure", conflict.Message);

            await Assert.ThrowsAsync<ArgumentException>(() => queue.AddAsync(
                "child", null, new JobsOptions { Parent = parent, Deduplication = new DeduplicationOptions { Id = "d" } }));

            // Bulk: nothing is added when any job is invalid
            await Assert.ThrowsAsync<ArgumentException>(() => queue.AddBulkAsync(new[]
            {
                ("ok", (object?)null, (JobsOptions?)null),
                ("bad", (object?)null, (JobsOptions?)new JobsOptions { ContinueParentOnFailure = true }),
            }));
            Assert.Equal(0, (await queue.GetJobCountsAsync()).Values.Sum());

            await Assert.ThrowsAsync<ArgumentException>(() => flow.AddAsync(new FlowJob
            {
                Name = "root",
                QueueName = q,
                Children = new[]
                {
                    new FlowJob
                    {
                        Name = "child",
                        QueueName = q,
                        Opts = new JobsOptions { FailParentOnFailure = true, RemoveDependencyOnFailure = true },
                    },
                },
            }));

            await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() =>
                flow.GetFlowAsync(new GetFlowOptions { Id = "any", QueueName = q, MaxChildren = 0 }));

            // A flow root with a parent outside the flow cannot be deduplicated
            await Assert.ThrowsAsync<ArgumentException>(() => flow.AddAsync(new FlowJob
            {
                Name = "root",
                QueueName = q,
                Opts = new JobsOptions { Parent = parent, Deduplication = new DeduplicationOptions { Id = "d" } },
            }));

            // ":" separates the queue and the id in job keys (as in Node.js)
            var colon = await Assert.ThrowsAsync<ArgumentException>(() =>
                queue.AddAsync("job", null, new JobsOptions { JobId = "part:42" }));
            Assert.Contains("cannot contain :", colon.Message);
            await Assert.ThrowsAsync<ArgumentException>(() => flow.AddAsync(new FlowJob
            {
                Name = "root",
                QueueName = q,
                Children = new[] { new FlowJob { Name = "child", QueueName = q, Opts = new JobsOptions { JobId = "a:b" } } },
            }));
            Assert.Equal(0, (await queue.GetJobCountsAsync()).Values.Sum());
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task GetFlow_ReturnsTheJobTree()
    {
        var q = UniqueName();
        var childQueue = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        await using var children = new Queue(childQueue, NewQueueOptions());
        await using var flow = new FlowProducer(NewQueueOptions());

        try
        {
            var tree = await flow.AddAsync(new FlowJob
            {
                Name = "root",
                QueueName = q,
                Children = new[]
                {
                    new FlowJob { Name = "leaf", QueueName = childQueue },
                    new FlowJob
                    {
                        Name = "middle",
                        QueueName = q,
                        Children = new[] { new FlowJob { Name = "grandchild", QueueName = childQueue } },
                    },
                },
            });

            var node = await flow.GetFlowAsync(new GetFlowOptions { Id = tree.Job.Id!, QueueName = q });
            Assert.NotNull(node);
            Assert.Equal("root", node!.Job.Name);
            Assert.Equal(tree.Job.Id, node.Job.Id);
            Assert.Equal(new[] { "leaf", "middle" }, node.Children!.Select(c => c.Job.Name).OrderBy(n => n));

            var leaf = node.Children!.Single(c => c.Job.Name == "leaf");
            Assert.Equal(childQueue, leaf.Job.QueueName);
            Assert.Null(leaf.Children);

            var middle = node.Children!.Single(c => c.Job.Name == "middle");
            Assert.Equal("grandchild", Assert.Single(middle.Children!).Job.Name);

            // Depth bounds the levels returned (the root counts as one).
            var shallow = await flow.GetFlowAsync(new GetFlowOptions { Id = tree.Job.Id!, QueueName = q, Depth = 2 });
            var shallowMiddle = shallow!.Children!.Single(c => c.Job.Name == "middle");
            Assert.Null(shallowMiddle.Children);

            // MaxChildren bounds the children fetched per category.
            var capped = await flow.GetFlowAsync(new GetFlowOptions { Id = tree.Job.Id!, QueueName = q, MaxChildren = 1 });
            Assert.Single(capped!.Children!);

            Assert.Null(await flow.GetFlowAsync(new GetFlowOptions { Id = "missing", QueueName = q }));
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
            await children.ObliterateAsync(force: true);
        }
    }

    [Fact]
    public async Task AddBulk_RegistersChildrenOnTheirParent()
    {
        var q = UniqueName();
        await using var queue = new Queue(q, NewQueueOptions());
        await using var flow = new FlowProducer(NewQueueOptions());

        try
        {
            var tree = await flow.AddAsync(new FlowJob
            {
                Name = "root",
                QueueName = q,
                Children = new[] { new FlowJob { Name = "first", QueueName = q } },
            });
            var parentQueue = (await queue.GetBackendAsync()).QualifiedName;
            var parent = new ParentOptions { Id = tree.Job.Id!, Queue = parentQueue };

            await queue.AddBulkAsync(new[]
            {
                ("second", (object?)null, (JobsOptions?)new JobsOptions { Parent = parent }),
                ("third", (object?)null, (JobsOptions?)new JobsOptions { Parent = parent }),
            });

            var node = await flow.GetFlowAsync(new GetFlowOptions { Id = tree.Job.Id!, QueueName = q });
            Assert.Equal(
                new[] { "first", "second", "third" },
                node!.Children!.Select(c => c.Job.Name).OrderBy(n => n));

            // A missing parent is an error, not a job id
            var missing = new ParentOptions { Id = "missing", Queue = parentQueue };
            await Assert.ThrowsAnyAsync<Exception>(() => queue.AddBulkAsync(new[]
            {
                ("orphan", (object?)null, (JobsOptions?)new JobsOptions { Parent = missing }),
            }));

            // Also for a flow root whose parent is outside the flow
            await Assert.ThrowsAnyAsync<Exception>(() => flow.AddAsync(new FlowJob
            {
                Name = "orphan-root",
                QueueName = q,
                Opts = new JobsOptions { Parent = missing },
            }));

            // Negative custom ids are ids, with or without a parent
            var added = await queue.AddBulkAsync(new[]
            {
                ("negative", (object?)null, (JobsOptions?)new JobsOptions { JobId = "-42" }),
            });
            Assert.Equal("-42", Assert.Single(added).Id);
            added = await queue.AddBulkAsync(new[]
            {
                ("negative-child", (object?)null, (JobsOptions?)new JobsOptions { JobId = "-43", Parent = parent }),
            });
            Assert.Equal("-43", Assert.Single(added).Id);
            Assert.NotNull(await queue.GetJobAsync("-43"));
        }
        finally
        {
            await queue.ObliterateAsync(force: true);
        }
    }

    private static async Task WaitUntilAsync(Func<Task<bool>> condition, int timeoutMs = 15000)
    {
        var deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < deadline)
        {
            if (await condition())
            {
                return;
            }

            await Task.Delay(50);
        }

        throw new TimeoutException("Timed out waiting for the expected condition.");
    }
}

/// <summary>Runs the child failure options suite against the Redis backend.</summary>
public sealed class RedisChildFailureOptionsTests : ChildFailureOptionsTestsBase
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_REDIS") ?? "localhost:6379";

    protected override QueueOptions NewQueueOptions() =>
        new() { Connection = ConnectionOptions.FromString(ConnectionString) };

    protected override WorkerOptions NewWorkerOptions() =>
        new() { Connection = ConnectionOptions.FromString(ConnectionString), Autorun = false };
}

/// <summary>Runs the child failure options suite against the PostgreSQL backend.</summary>
public sealed class PostgresChildFailureOptionsTests : ChildFailureOptionsTestsBase
{
    private static string ConnectionString =>
        Environment.GetEnvironmentVariable("BULLMQ_TEST_POSTGRES")
        ?? $"Host=localhost;Database=bullmq_test;Username={Environment.UserName}";

    protected override QueueOptions NewQueueOptions() =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString } };

    protected override WorkerOptions NewWorkerOptions() =>
        new() { Postgres = new PostgresOptions { ConnectionString = ConnectionString }, Autorun = false };
}
