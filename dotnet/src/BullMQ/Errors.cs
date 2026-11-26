namespace BullMQ;

/// <summary>
/// Base class for errors raised by the shared Lua scripts (via a negative
/// <see cref="ErrorCode"/>).
/// </summary>
public class BullMQException : Exception
{
    public BullMQException(string message) : base(message) { }
    public BullMQException(string message, Exception inner) : base(message, inner) { }
}

/// <summary>
/// An error that should not be retried by the worker. Throwing this from a
/// processor (or having the scripts return the corresponding code) fails the job
/// immediately, bypassing the configured retry attempts.
/// </summary>
public sealed class UnrecoverableException : BullMQException
{
    public UnrecoverableException(string message) : base(message) { }
}

/// <summary>
/// Control-flow exception used by manual processors after explicitly moving an
/// active job to delayed. Throwing this tells <see cref="Worker"/> not to
/// auto-fail the job.
/// </summary>
public sealed class DelayedException : BullMQException
{
    public const string DefaultMessage = "bullmq:movedToDelayed";

    public DelayedException(string message = DefaultMessage) : base(message) { }
}

/// <summary>
/// Thrown by a processor after rate limiting the queue manually (e.g. with
/// <see cref="Worker.RateLimitAsync"/> or <see cref="Queue.RateLimitAsync"/>).
/// The worker moves the job back to wait without consuming an attempt or
/// raising <see cref="Worker.Failed"/>, and waits until the rate limit lifts.
/// </summary>
public sealed class RateLimitException : BullMQException
{
    public const string DefaultMessage = "bullmq:rateLimitExceeded";

    public RateLimitException(string message = DefaultMessage) : base(message) { }
}

/// <summary>
/// Thrown when the PostgreSQL schema requires a newer BullMQ major version than
/// this client implements, i.e. it was migrated by a newer BullMQ release whose
/// structures this client may not understand. Upgrade BullMQ; schema downgrades
/// are not supported. Mirrors the Node.js <c>SchemaVersionMismatchError</c>.
/// </summary>
public sealed class SchemaVersionMismatchException : BullMQException
{
    public SchemaVersionMismatchException(int minimumClientVersion, int clientVersion)
        : base(
            $"BullMQ: the PostgreSQL schema requires BullMQ major version {minimumClientVersion} " +
            $"or newer, but this client is major version {clientVersion}. Upgrade BullMQ to use this schema.")
    {
        MinimumClientVersion = minimumClientVersion;
        ClientVersion = clientVersion;
    }

    /// <summary>The minimum BullMQ major version recorded in the schema's migration ledger.</summary>
    public int MinimumClientVersion { get; }

    /// <summary>The BullMQ major version (of the shared schema) this client implements.</summary>
    public int ClientVersion { get; }
}

/// <summary>Maps script error codes to the corresponding exception.</summary>
internal static class FinishedErrors
{
    public static BullMQException Create(
        int code,
        string? jobId = null,
        string? parentKey = null,
        string? command = null,
        string? state = null)
    {
        return (ErrorCode)code switch
        {
            ErrorCode.JobNotExist =>
                new BullMQException($"Missing key for job {jobId}. {command}"),
            ErrorCode.JobLockNotExist =>
                new BullMQException($"Missing lock for job {jobId}. {command}"),
            ErrorCode.JobNotInState =>
                new BullMQException($"Job {jobId} is not in the {state} state. {command}"),
            ErrorCode.JobPendingDependencies =>
                new BullMQException($"Job {jobId} has pending dependencies. {command}"),
            ErrorCode.ParentJobNotExist =>
                new BullMQException($"Missing key for parent job {parentKey}. {command}"),
            ErrorCode.JobLockMismatch =>
                new BullMQException($"Lock mismatch for job {jobId}. Cmd {command} from {state}"),
            ErrorCode.ParentJobCannotBeReplaced =>
                new BullMQException($"The parent job {jobId} cannot be replaced. {command}"),
            ErrorCode.JobHasFailedChildren =>
                new UnrecoverableException(
                    $"Cannot complete job {jobId} because it has at least one failed child. {command}"),
            ErrorCode.SchedulerJobIdCollision =>
                new BullMQException(
                    $"Cannot create job scheduler iteration - job ID already exists. {command}"),
            ErrorCode.SchedulerJobSlotsBusy =>
                new BullMQException(
                    $"Cannot create job scheduler iteration - current and next time slots already have jobs. {command}"),
            _ => new BullMQException($"Unknown code {code} error for {jobId}. {command}"),
        };
    }
}
