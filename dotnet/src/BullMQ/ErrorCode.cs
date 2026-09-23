namespace BullMQ;

/// <summary>
/// Negative status codes returned by the shared Lua scripts to signal a failure
/// condition. Kept in sync with the reference implementation so that error
/// handling is identical across every BullMQ runtime.
/// </summary>
public enum ErrorCode
{
    JobNotExist = -1,
    JobLockNotExist = -2,
    JobNotInState = -3,
    JobPendingDependencies = -4,
    ParentJobNotExist = -5,
    JobLockMismatch = -6,
    ParentJobCannotBeReplaced = -7,
    JobHasFailedChildren = -9,
    SchedulerJobIdCollision = -10,
    SchedulerJobSlotsBusy = -11,
}
