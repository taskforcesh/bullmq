namespace BullMQ;

/// <summary>
/// The lifecycle states a job can be in. The string values match the Redis
/// key/list names used by the shared Lua scripts.
/// </summary>
public enum JobState
{
    Completed,
    Failed,
    Delayed,
    Active,
    Prioritized,
    Waiting,
    WaitingChildren,
    Unknown,
}

/// <summary>Helpers for converting <see cref="JobState"/> to/from its wire string.</summary>
public static class JobStateExtensions
{
    public static string ToWireString(this JobState state) => state switch
    {
        JobState.Completed => "completed",
        JobState.Failed => "failed",
        JobState.Delayed => "delayed",
        JobState.Active => "active",
        JobState.Prioritized => "prioritized",
        JobState.Waiting => "waiting",
        JobState.WaitingChildren => "waiting-children",
        _ => "unknown",
    };

    public static JobState FromWireString(string? value) => value switch
    {
        "completed" => JobState.Completed,
        "failed" => JobState.Failed,
        "delayed" => JobState.Delayed,
        "active" => JobState.Active,
        "prioritized" => JobState.Prioritized,
        "waiting" => JobState.Waiting,
        "waiting-children" => JobState.WaitingChildren,
        _ => JobState.Unknown,
    };
}
