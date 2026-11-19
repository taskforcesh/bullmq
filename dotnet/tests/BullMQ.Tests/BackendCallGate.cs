using System.Reflection;
using System.Runtime.ExceptionServices;
using BullMQ;

namespace BullMQ.Tests;

/// <summary>
/// Holds every call a worker makes to one backend method until <see cref="Release"/>,
/// so a test can act while the worker is awaiting that call. Pass <see cref="Wrap"/>
/// as the worker's backend decorator; every call is forwarded to the real backend.
/// </summary>
public sealed class BackendCallGate
{
    private readonly TaskCompletionSource<bool> _entered = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly TaskCompletionSource<bool> _released = new(TaskCreationOptions.RunContinuationsAsynchronously);

    /// <param name="method">The gated method; it must return <see cref="Task{TResult}"/>.</param>
    public BackendCallGate(string method) => Method = method;

    public string Method { get; }

    /// <summary>Completes when the first gated call arrives.</summary>
    public Task<bool> Entered => _entered.Task;

    public void Release() => _released.TrySetResult(true);

    public IQueueBackend Wrap(IQueueBackend target)
    {
        var proxy = DispatchProxy.Create<IQueueBackend, GatedBackendProxy>();
        var gated = (GatedBackendProxy)(object)proxy;
        gated.Target = target;
        gated.Gate = this;
        return proxy;
    }

    internal async Task HoldAsync()
    {
        _entered.TrySetResult(true);
        await _released.Task.ConfigureAwait(false);
    }
}

/// <summary>The <see cref="DispatchProxy"/> behind <see cref="BackendCallGate.Wrap"/>.</summary>
public class GatedBackendProxy : DispatchProxy
{
    private static readonly MethodInfo HoldThenForwardMethod = typeof(GatedBackendProxy)
        .GetMethod(nameof(HoldThenForwardAsync), BindingFlags.NonPublic | BindingFlags.Instance)!;

    internal IQueueBackend Target { get; set; } = null!;

    internal BackendCallGate Gate { get; set; } = null!;

    protected override object? Invoke(MethodInfo? targetMethod, object?[]? args)
    {
        if (targetMethod!.Name != Gate.Method)
        {
            return Forward(targetMethod, args);
        }

        var returnType = targetMethod.ReturnType;
        if (!returnType.IsGenericType || returnType.GetGenericTypeDefinition() != typeof(Task<>))
        {
            throw new NotSupportedException($"{targetMethod.Name} does not return Task<T>");
        }

        return HoldThenForwardMethod
            .MakeGenericMethod(returnType.GetGenericArguments()[0])
            .Invoke(this, new object?[] { targetMethod, args });
    }

    private async Task<T> HoldThenForwardAsync<T>(MethodInfo method, object?[]? args)
    {
        await Gate.HoldAsync().ConfigureAwait(false);
        return await ((Task<T>)Forward(method, args)!).ConfigureAwait(false);
    }

    private object? Forward(MethodInfo method, object?[]? args)
    {
        try
        {
            return method.Invoke(Target, args);
        }
        catch (TargetInvocationException ex) when (ex.InnerException is not null)
        {
            ExceptionDispatchInfo.Capture(ex.InnerException).Throw();
            throw;
        }
    }
}
