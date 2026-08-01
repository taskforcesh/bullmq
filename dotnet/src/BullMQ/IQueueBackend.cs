namespace BullMQ;

/// <summary>
/// Database-agnostic contract describing every high-level operation the
/// <see cref="Queue"/>, <see cref="Worker"/> and <see cref="Job"/> classes need
/// in order to function.
///
/// This mirrors the reference cross-backend contract (see the Node.js
/// <c>IQueueBackend</c> and the Python <c>Backend</c> ABC). The goal is to
/// express the queue semantics ("move job to active", "extend lock", "promote
/// job", ...) independently of the underlying datastore, so both the Redis and
/// PostgreSQL adapters fulfil the same operations without any change to the
/// high-level classes.
/// </summary>
public interface IQueueBackend : IAsyncDisposable
{
    // ============================================================
    // Connection lifecycle
    // ============================================================

    /// <summary>Resolves once the backend's connection(s) are ready.</summary>
    Task WaitUntilReadyAsync();

    /// <summary>Closes the backend and its owned connection(s).</summary>
    Task CloseAsync(bool force = false);

    /// <summary>Forcibly disconnects the backend's underlying connection(s).</summary>
    Task DisconnectAsync();

    /// <summary>Truthy once <see cref="CloseAsync"/> has begun.</summary>
    bool Closing { get; }

    /// <summary>Sets a human-readable name on the underlying connection.</summary>
    Task SetNameAsync(string name);

    /// <summary>
    /// Returns a sibling backend bound to a different queue that shares this
    /// backend's underlying connection(s). Used by flows spanning queues.
    /// </summary>
    IQueueBackend ForQueue(string queueName, string? prefix = null);

    /// <summary>Smallest meaningful blocking timeout (seconds) for the blocking primitive.</summary>
    double MinimumBlockTimeout { get; }

    /// <summary>Datastore capability flags used to bound the worker's blocking wait.</summary>
    BackendCapabilities Capabilities { get; }

    // ============================================================
    // Identity & keys
    // ============================================================

    /// <summary>The queue's fully-qualified name (cross-backend logical identifier).</summary>
    string QualifiedName { get; }

    /// <summary>The map of named sub-keys/identifiers for the queue (empty for Postgres).</summary>
    IReadOnlyDictionary<string, string> Keys { get; }

    /// <summary>Builds a namespaced sub-key/identifier of the given type.</summary>
    string ToKey(string type);

    /// <summary>Builds the connection client name (for discovery / observability).</summary>
    string ClientName(string? suffix = null);

    // ============================================================
    // Adding jobs
    // ============================================================

    /// <summary>Adds a single job, routing it to the correct initial state.</summary>
    Task<string> AddJobAsync(Job job);

    /// <summary>Adds many independent jobs in a single efficient operation.</summary>
    Task<IReadOnlyList<string>> AddJobsAsync(IReadOnlyList<Job> jobs);

    // ============================================================
    // State transitions
    // ============================================================

    /// <summary>Moves the next eligible job to active, returning its data (or delay signals).</summary>
    Task<NextJobData> MoveToActiveAsync(string token, string? name = null);

    /// <summary>Moves an active job to completed and optionally fetches the next job.</summary>
    Task<MoveToFinishedResult> MoveToCompletedAsync(
        Job job, string returnValueJson, object? removeOnComplete, string token, bool fetchNext);

    /// <summary>Moves an active job to failed and optionally fetches the next job.</summary>
    Task<MoveToFinishedResult> MoveToFailedAsync(
        Job job, string failedReason, object? removeOnFail, string token, bool fetchNext,
        string? stackTraceJson = null);

    /// <summary>Moves a job to the delayed state, scheduling it after <paramref name="delay"/> ms.</summary>
    Task<NextJobData?> MoveToDelayedAsync(
        string jobId, long timestamp, long delay, string token = "0", bool fetchNext = false);

    /// <summary>Moves a parent job to the waiting-children state. Returns true if moved.</summary>
    Task<bool> MoveToWaitingChildrenAsync(string jobId, string token, string? childKey = null);

    /// <summary>Retries a failed/active job immediately by pushing it back to wait.</summary>
    Task RetryJobAsync(string jobId, bool lifo, string token = "0");

    /// <summary>Reprocesses a finished (failed/completed) job, moving it back to wait.</summary>
    Task ReprocessJobAsync(Job job, string state, bool resetAttemptsMade = false, bool resetAttemptsStarted = false);

    /// <summary>Promotes a single delayed job so it can be processed as soon as possible.</summary>
    Task PromoteAsync(string jobId);

    /// <summary>Recovers stalled jobs (active jobs whose lock expired) back to wait.</summary>
    Task<IReadOnlyList<string>> MoveStalledJobsToWaitAsync(int maxStalledCount, int stalledInterval);

    // ============================================================
    // Bulk admin transitions
    // ============================================================

    /// <summary>Moves up to <paramref name="count"/> finished jobs of the given state back to wait.</summary>
    Task<long> RetryJobsAsync(string state, int count, long timestamp);

    /// <summary>Promotes up to <paramref name="count"/> delayed jobs back to wait.</summary>
    Task<long> PromoteJobsAsync(int count);

    /// <summary>Pauses or resumes the whole queue.</summary>
    Task PauseAsync(bool pause);

    /// <summary>Removes waiting (and optionally delayed) jobs from the queue.</summary>
    Task DrainAsync(bool delayed);

    /// <summary>Removes jobs in a given state that are older than <paramref name="grace"/> ms.</summary>
    Task<IReadOnlyList<string>> CleanJobsInSetAsync(string set, long grace, int limit);

    /// <summary>Irreversibly destroys the queue and its contents; returns a cursor (0 = done).</summary>
    Task<long> ObliterateAsync(bool force, int count);

    /// <summary>Removes a job and (optionally) its children. Returns 1 if removed, 0 otherwise.</summary>
    Task<long> RemoveAsync(string jobId, bool removeChildren);

    // ============================================================
    // Locks
    // ============================================================

    /// <summary>Extends the lock of a single active job. Returns 1 if renewed.</summary>
    Task<long> ExtendLockAsync(string jobId, string token, int duration);

    /// <summary>Extends several locks at once; returns the ids that could not be renewed.</summary>
    Task<IReadOnlyList<string>> ExtendLocksAsync(
        IReadOnlyList<string> jobIds, IReadOnlyList<string> tokens, int duration);

    // ============================================================
    // Job mutations
    // ============================================================

    /// <summary>Replaces a job's data payload.</summary>
    Task UpdateDataAsync(string jobId, object? data);

    /// <summary>Updates a job's progress and emits the corresponding event.</summary>
    Task UpdateProgressAsync(string jobId, object? progress);

    /// <summary>Changes the priority (and optionally lifo) of a waiting job.</summary>
    Task ChangePriorityAsync(string jobId, int priority = 0, bool lifo = false);

    /// <summary>Appends a row to a job's log, optionally trimming. Returns the total count.</summary>
    Task<long> AddLogAsync(string jobId, string logRow, int keepLogs = 0);

    // ============================================================
    // Queries
    // ============================================================

    /// <summary>Returns the current state of a job.</summary>
    Task<JobState> GetStateAsync(string jobId);

    /// <summary>Returns whether a job id is present in the given state.</summary>
    Task<bool> IsJobInStateAsync(string state, string jobId);

    /// <summary>Returns the stored data for a job, or null if missing.</summary>
    Task<JobJson?> GetJobDataAsync(string jobId);

    /// <summary>Returns a page of a job's logs together with the total count.</summary>
    Task<JobLogs> GetJobLogsAsync(string jobId, int start = 0, int end = -1, bool asc = true);

    /// <summary>Returns the ttl (ms) of the current rate-limit window.</summary>
    Task<long> GetRateLimitTtlAsync();

    /// <summary>Returns the counts for the given job types, in order.</summary>
    Task<long[]> GetCountsAsync(params string[] types);

    /// <summary>Returns the number of jobs per priority, in order.</summary>
    Task<long[]> GetCountsPerPriorityAsync(IReadOnlyList<long> priorities);

    /// <summary>Returns a page of job ids for the given states/types.</summary>
    Task<IReadOnlyList<string>> GetRangesAsync(
        IReadOnlyList<string> types, int start = 0, int end = 1, bool asc = false);

    /// <summary>Returns the raw processed-children map (child key -> serialized value).</summary>
    Task<IReadOnlyDictionary<string, string>> GetProcessedChildrenValuesAsync(string jobId);

    /// <summary>Returns whether the queue is currently paused.</summary>
    Task<bool> IsPausedAsync();

    /// <summary>Returns the raw worker/client list(s) for the queue's datastore.</summary>
    Task<IReadOnlyList<string>> GetClientListAsync();

    // ============================================================
    // Queue metadata & maintenance keys
    // ============================================================

    /// <summary>Sets one or more queue metadata fields.</summary>
    Task SetQueueMetaAsync(IReadOnlyDictionary<string, object> values);

    /// <summary>Reads a single queue metadata field.</summary>
    Task<string?> GetQueueMetaFieldAsync(string field);

    /// <summary>Returns whether a queue metadata field exists.</summary>
    Task<bool> HasQueueMetaFieldAsync(string field);

    /// <summary>Trims the event stream to an approximate maximum length.</summary>
    Task<long> TrimEventsAsync(long maxLength);

    /// <summary>Removes the deprecated priority helper key.</summary>
    Task<long> RemoveDeprecatedPriorityKeyAsync();

    // ============================================================
    // Worker blocking primitive
    // ============================================================

    /// <summary>
    /// Blocks (up to <paramref name="blockTimeoutSeconds"/>) until the queue
    /// signals that a job may be available, returning the marker entry or null.
    /// </summary>
    Task<MarkerResult?> WaitForJobAsync(double blockTimeoutSeconds);
}

/// <summary>Datastore capability flags.</summary>
public readonly record struct BackendCapabilities(bool CanBlockFor1Ms, bool CanDoubleTimeout);

/// <summary>A page of a job's logs together with the total count.</summary>
public readonly record struct JobLogs(IReadOnlyList<string> Logs, long Count);

/// <summary>The marker entry returned by the blocking wait primitive.</summary>
public readonly record struct MarkerResult(string Member, double Score);

/// <summary>The result of a move-to-finished transition.</summary>
public readonly struct MoveToFinishedResult
{
    /// <summary>The next job to process, when <c>fetchNext</c> was requested and one was available.</summary>
    public NextJobData? Next { get; init; }

    /// <summary>The recorded <c>finishedOn</c> timestamp.</summary>
    public long FinishedOn { get; init; }
}
