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
