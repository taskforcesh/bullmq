namespace BullMQ;

/// <summary>
/// Options describing how a job scheduler repeats. Exactly one of
/// <see cref="Pattern"/> (a cron expression) or <see cref="Every"/> (a fixed
/// interval in milliseconds) must be provided.
/// </summary>
public sealed class RepeatOptions
{
    /// <summary>A cron expression (5 or 6 fields). Mutually exclusive with <see cref="Every"/>.</summary>
    public string? Pattern { get; set; }

    /// <summary>A fixed interval in milliseconds. Mutually exclusive with <see cref="Pattern"/>.</summary>
    public long? Every { get; set; }

    /// <summary>Maximum number of iterations to produce.</summary>
    public int? Limit { get; set; }

    /// <summary>Offset (ms) applied to each iteration's scheduled time.</summary>
    public long? Offset { get; set; }

    /// <summary>When true, the first iteration is produced immediately.</summary>
    public bool? Immediately { get; set; }

    /// <summary>Start date (ms since epoch or ISO 8601 string).</summary>
    public object? StartDate { get; set; }

    /// <summary>End date (ms since epoch or ISO 8601 string). No iterations after this.</summary>
    public object? EndDate { get; set; }

    /// <summary>IANA timezone name used to evaluate <see cref="Pattern"/>.</summary>
    public string? Tz { get; set; }

    /// <summary>Internal: the current iteration count.</summary>
    public int? Count { get; set; }

    /// <summary>Internal: the previous iteration's scheduled time (ms).</summary>
    public long? PrevMillis { get; set; }
}

/// <summary>The job template a scheduler uses for every iteration it produces.</summary>
public sealed class JobSchedulerTemplate
{
    public string? Name { get; set; }
    public object? Data { get; set; }
    public JobsOptions? Opts { get; set; }
}

/// <summary>A stored job scheduler record (returned by the getters).</summary>
public sealed class JobSchedulerJson
{
    public string Key { get; set; } = string.Empty;
    public string? Name { get; set; }

    /// <summary>Next scheduled run (ms since epoch), if known.</summary>
    public long? Next { get; set; }

    public int? IterationCount { get; set; }
    public int? Limit { get; set; }
    public long? StartDate { get; set; }
    public long? EndDate { get; set; }
    public string? Tz { get; set; }
    public string? Pattern { get; set; }
    public long? Every { get; set; }
    public long? Offset { get; set; }

    /// <summary>The template payload (deserialized), if stored.</summary>
    public object? Template { get; set; }
}
