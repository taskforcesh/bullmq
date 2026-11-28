using System.Reflection;
using BullMQ;
using Xunit;

namespace BullMQ.Tests;

public sealed class LockManagerTests
{
    [Fact]
    public async Task LateFailedRenewal_DoesNotUntrackSameTokenRetry()
    {
        var firstRenewalEntered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseFirstRenewal = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var retryRenewalEntered = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        var calls = 0;
        var backend = DispatchProxy.Create<IQueueBackend, LockManagerTestBackendProxy>();
        var proxy = (LockManagerTestBackendProxy)(object)backend;
        proxy.ExtendLocks = async jobIds =>
        {
            if (Interlocked.Increment(ref calls) == 1)
            {
                firstRenewalEntered.TrySetResult(true);
                await releaseFirstRenewal.Task.ConfigureAwait(false);
                return jobIds;
            }

            retryRenewalEntered.TrySetResult(true);
            return Array.Empty<string>();
        };

        var manager = new LockManager(backend, 20, 1000, _ => { }, _ => { }, _ => { });
        const string jobId = "job";
        const string token = "same-slot-token";

        try
        {
            manager.Start();
            var firstGeneration = manager.TrackJob(jobId, token, 1);
            await firstRenewalEntered.Task.WaitAsync(TimeSpan.FromSeconds(5));

            manager.UntrackJob(jobId, token, firstGeneration);
            var retryGeneration = manager.TrackJob(jobId, token, 0);
            Assert.NotEqual(firstGeneration, retryGeneration);

            releaseFirstRenewal.TrySetResult(true);
            await retryRenewalEntered.Task.WaitAsync(TimeSpan.FromSeconds(5));

            Assert.Equal(1, manager.ActiveJobCount);
        }
        finally
        {
            releaseFirstRenewal.TrySetResult(true);
            await manager.CloseAsync();
        }
    }
}

public class LockManagerTestBackendProxy : DispatchProxy
{
    internal Func<IReadOnlyList<string>, Task<IReadOnlyList<string>>> ExtendLocks { get; set; } = null!;

    protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
    {
        if (targetMethod?.Name == nameof(IQueueBackend.ExtendLocksAsync))
        {
            return ExtendLocks((IReadOnlyList<string>)args![0]!);
        }

        throw new NotSupportedException($"Unexpected backend call: {targetMethod?.Name}");
    }
}
