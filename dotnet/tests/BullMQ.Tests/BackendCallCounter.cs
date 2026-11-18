using System.Collections.Concurrent;
using System.Reflection;
using System.Runtime.ExceptionServices;
using BullMQ;

namespace BullMQ.Tests;

/// <summary>
/// Counts the calls a worker makes on its backend. Pass <see cref="Wrap"/> as the
/// worker's backend decorator; every call is forwarded to the real backend.
/// Unlike server-wide counters (e.g. Redis <c>INFO commandstats</c>) this is not
/// polluted by other clients of the shared test servers.
/// </summary>
public sealed class BackendCallCounter
{
    /// <summary>Suffix of the key counting finish calls that requested fetch-next.</summary>
    public const string FetchNext = ":fetchNext";

    private readonly ConcurrentDictionary<string, int> _calls = new(StringComparer.Ordinal);

    /// <summary>Number of calls to <paramref name="method"/> (optionally suffixed with <see cref="FetchNext"/>).</summary>
    public int Count(string method) => _calls.TryGetValue(method, out var count) ? count : 0;

    public IQueueBackend Wrap(IQueueBackend target)
    {
        var proxy = DispatchProxy.Create<IQueueBackend, CountingBackendProxy>();
        var counting = (CountingBackendProxy)(object)proxy;
        counting.Target = target;
        counting.Counter = this;
        return proxy;
    }

    internal void Record(string method) => _calls.AddOrUpdate(method, 1, (_, count) => count + 1);
}

/// <summary>The <see cref="DispatchProxy"/> behind <see cref="BackendCallCounter.Wrap"/>.</summary>
public class CountingBackendProxy : DispatchProxy
{
    internal IQueueBackend Target { get; set; } = null!;

    internal BackendCallCounter Counter { get; set; } = null!;

    protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
    {
        Counter.Record(targetMethod!.Name);
        if (targetMethod.Name is nameof(IQueueBackend.MoveToCompletedAsync) or nameof(IQueueBackend.MoveToFailedAsync)
            && args is { Length: > 4 } && args[4] is true)
        {
            Counter.Record(targetMethod.Name + BackendCallCounter.FetchNext);
        }

        try
        {
            return targetMethod.Invoke(Target, args);
        }
        catch (TargetInvocationException ex) when (ex.InnerException is not null)
        {
            ExceptionDispatchInfo.Capture(ex.InnerException).Throw();
            throw;
        }
    }
}
