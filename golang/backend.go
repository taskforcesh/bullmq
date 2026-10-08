package bullmq

import (
	"context"
	"encoding/json"
	"time"
)

// Backend is the datastore-agnostic contract describing every high-level
// operation that [Queue], [Worker], [QueueEvents] and [Job] need in order to
// function. It is the Go counterpart of the `IQueueBackend` interface of the
// Node.js implementation (src/interfaces/queue-backend.ts) and keeps the same
// operation names and semantics.
//
// The interface expresses the queue semantics ("move job to active", "extend
// lock", "promote job", ...) independently of the underlying store. The Redis
// implementation is [RedisBackend]; a PostgreSQL implementation can be plugged
// in through [BackendFactory] without any change to Queue, Worker, QueueEvents
// or Job.
//
// Rules for implementations:
//
//   - Methods use only exported domain types. Redis specifics (Lua scripts,
//     key names, msgpack encoding, reply parsing) stay private to the
//     implementation.
//   - A backend owns its connection(s). Callers never thread a connection or
//     a transaction through an operation.
//   - Operations that fail because of queue semantics return the sentinel
//     errors of this package (for example [ErrJobNotFound] or
//     [ErrJobLockNotExist]), directly or wrapped in a [ScriptError].
//   - All methods must be safe for concurrent use.
type Backend interface {
	// ------------------------------------------------------------------
	// Connection lifecycle
	// ------------------------------------------------------------------

	// Close releases every connection owned by the backend. Connections that
	// were supplied by the caller are left open.
	Close() error

	// SetName labels the connection used for blocking reads, for
	// observability. It is a no-op for backends without such a concept.
	SetName(ctx context.Context, name string) error

	// IsTransientError reports whether err is a connectivity or availability
	// problem that is worth retrying, as opposed to a logic error.
	IsTransientError(err error) bool

	// ------------------------------------------------------------------
	// Queue identity
	// ------------------------------------------------------------------

	// QueueName returns the bare queue name.
	QueueName() string

	// QualifiedName returns the cross-backend logical identifier of the queue,
	// used for example as a flow parent reference. Redis: `{prefix}:{queue}`.
	QualifiedName() string

	// ClientName builds the connection name used for worker discovery. Redis:
	// `{prefix}:{base64(queue)}{suffix}`.
	ClientName(suffix string) string

	// ------------------------------------------------------------------
	// Adding jobs
	// ------------------------------------------------------------------

	// AddJob adds a single job, routing it to its initial state (wait,
	// delayed, prioritized, waiting-children) based on its options, and
	// returns its id.
	AddJob(ctx context.Context, job NewJob) (string, error)

	// AddJobs adds many jobs in a single efficient operation (a Redis
	// transaction, a multi-row INSERT, ...) and returns their ids in order.
	AddJobs(ctx context.Context, jobs []NewJob) ([]string, error)

	// ------------------------------------------------------------------
	// Job state transitions
	// ------------------------------------------------------------------

	// MoveToActive atomically moves the next eligible job to active and locks
	// it. When no job is ready the result carries how long to wait.
	MoveToActive(ctx context.Context, opts MoveToActiveOptions) (*FetchResult, error)

	// MoveToCompleted moves an active job to completed and returns the
	// recorded finishedOn timestamp (Unix milliseconds).
	MoveToCompleted(ctx context.Context, jobID string, returnValue []byte, opts FinishOptions) (int64, error)

	// MoveToFailed moves an active job to failed and returns the recorded
	// finishedOn timestamp (Unix milliseconds).
	MoveToFailed(ctx context.Context, jobID string, failure FailureInfo, opts FinishOptions) (int64, error)

	// MoveToDelayed reschedules an active job to run after delay.
	MoveToDelayed(ctx context.Context, jobID, token string, delay time.Duration, opts MoveToDelayedOptions) error

	// MoveToWaitingChildren parks an active parent job until its children
	// finish. It returns true when the job was moved and false when there were
	// no pending dependencies.
	MoveToWaitingChildren(ctx context.Context, jobID, token string, child *ParentKeys) (bool, error)

	// RetryJob puts an active job straight back into the wait list.
	RetryJob(ctx context.Context, jobID, token string, lifo bool, failure *FailureInfo) error

	// RetryFinishedJob reprocesses a completed or failed job.
	RetryFinishedJob(ctx context.Context, jobID string, state JobState, lifo bool) error

	// Promote makes a delayed job available immediately.
	Promote(ctx context.Context, jobID string) error

	// MoveStalledJobsToWait recovers active jobs whose lock expired and returns
	// the ids of the jobs that were moved.
	MoveStalledJobsToWait(ctx context.Context, opts StalledOptions) ([]string, error)

	// ------------------------------------------------------------------
	// Bulk and administrative transitions
	// ------------------------------------------------------------------

	// RetryFinishedJobs moves up to count finished jobs of state back to wait.
	// It returns a cursor: 0 once nothing is left to move.
	RetryFinishedJobs(ctx context.Context, state JobState, count, timestamp int64) (int64, error)

	// PromoteJobs moves up to count delayed jobs back to wait. It returns a
	// cursor: 0 once nothing is left to move.
	PromoteJobs(ctx context.Context, count int64) (int64, error)

	// Pause pauses (true) or resumes (false) the whole queue.
	Pause(ctx context.Context, paused bool) error

	// Drain removes waiting jobs, and delayed jobs too when delayed is true.
	Drain(ctx context.Context, delayed bool) error

	// CleanJobsByState removes up to limit jobs of state that are older than
	// timestamp (Unix milliseconds) and returns their ids.
	CleanJobsByState(ctx context.Context, state JobState, timestamp, limit int64) ([]string, error)

	// Obliterate destroys the queue and its contents in batches of count. It
	// returns a cursor: 0 once the obliteration is complete.
	Obliterate(ctx context.Context, force bool, count int64) (int64, error)

	// ------------------------------------------------------------------
	// Locks
	// ------------------------------------------------------------------

	// ExtendLock refreshes the lock of one active job. It returns
	// [ErrJobLockNotExist] when the lock is gone or owned by another token.
	ExtendLock(ctx context.Context, jobID, token string, duration time.Duration) error

	// ExtendLocks refreshes the locks of several active jobs at once and
	// returns the ids whose lock could not be extended.
	ExtendLocks(ctx context.Context, locks []JobLock, duration time.Duration) ([]string, error)

	// ------------------------------------------------------------------
	// Job mutations
	// ------------------------------------------------------------------

	// UpdateData replaces the JSON payload of a job.
	UpdateData(ctx context.Context, jobID string, data []byte) error

	// UpdateProgress stores a job's progress and emits the progress event.
	UpdateProgress(ctx context.Context, jobID string, progress Progress) error

	// AddLog appends a row to the job's log, keeping at most keepLogs rows when
	// keepLogs is positive, and returns the number of rows.
	AddLog(ctx context.Context, jobID, row string, keepLogs int64) (int64, error)

	// GetJobLogs returns the log rows in [start, end] and the total row count.
	GetJobLogs(ctx context.Context, jobID string, start, end int64) ([]string, int64, error)

	// ChangeDelay changes the delay of a delayed job.
	ChangeDelay(ctx context.Context, jobID string, delay time.Duration) error

	// ChangePriority changes the priority (and lifo flag) of a waiting job.
	ChangePriority(ctx context.Context, jobID string, priority int64, lifo bool) error

	// Remove deletes a job and, optionally, its children. It returns false when
	// the job (or a dependency) is locked by another worker.
	Remove(ctx context.Context, jobID string, removeChildren bool) (bool, error)

	// ------------------------------------------------------------------
	// Queue and job queries
	// ------------------------------------------------------------------

	// GetState returns the state of a job, or [StateUnknown].
	GetState(ctx context.Context, jobID string) (JobState, error)

	// GetJob returns the stored job, or nil when it does not exist.
	GetJob(ctx context.Context, jobID string) (*JobRecord, error)

	// GetJobs returns the jobs in state, ordered by their position in it.
	GetJobs(ctx context.Context, state JobState, start, end int64, asc bool) ([]*JobRecord, error)

	// GetCounts returns the number of jobs per requested state, in order.
	GetCounts(ctx context.Context, states []JobState) ([]int64, error)

	// GetRanges returns the job ids of state in [start, end].
	GetRanges(ctx context.Context, state JobState, start, end int64, asc bool) ([]string, error)

	// IsMaxed reports whether the queue reached its global concurrency limit.
	IsMaxed(ctx context.Context) (bool, error)

	// GetRateLimitTTL returns the remaining ttl in milliseconds of the current
	// rate limit window.
	GetRateLimitTTL(ctx context.Context, maxJobs int64) (int64, error)

	// GetMetrics returns the metrics collected for the completed or failed
	// state.
	GetMetrics(ctx context.Context, state JobState, start, end int64) (*Metrics, error)

	// GetClientList returns the raw connection list(s) of the datastore, used
	// for worker discovery. Backends with no such concept may return nothing.
	GetClientList(ctx context.Context) ([]string, error)

	// ------------------------------------------------------------------
	// Queue metadata
	// ------------------------------------------------------------------

	// SetQueueMeta sets one or more queue metadata fields.
	SetQueueMeta(ctx context.Context, values map[string]any) error

	// GetQueueMetaField reads a single metadata field. The bool is false when
	// the field does not exist.
	GetQueueMetaField(ctx context.Context, field string) (string, bool, error)

	// RemoveQueueMetaFields removes metadata fields.
	RemoveQueueMetaFields(ctx context.Context, fields ...string) error

	// ------------------------------------------------------------------
	// Events and the worker blocking primitive
	// ------------------------------------------------------------------

	// LastEventID returns the id of the newest event, or "0-0" when the stream
	// is empty. Reading from it only yields events produced afterwards.
	LastEventID(ctx context.Context) (string, error)

	// ReadEvents blocks up to block waiting for events newer than lastID. It
	// returns no events when the wait times out.
	ReadEvents(ctx context.Context, lastID string, block time.Duration) ([]QueueEvent, error)

	// WaitForJob blocks up to timeout until the queue signals that a job may be
	// available, a delayed job came due, or ctx is done. A timeout is not an
	// error. It uses the connection dedicated to blocking reads.
	WaitForJob(ctx context.Context, timeout time.Duration) error
}

// BackendOptions describes the role of the backend being built by a
// [BackendFactory].
type BackendOptions struct {
	// Prefix is the keyspace prefix requested by the caller; empty means the
	// backend default. Backends with no prefix concept may ignore it.
	Prefix string
	// WithBlockingConnection requests a connection dedicated to WaitForJob and
	// ReadEvents, so a blocked read never starves other operations.
	WithBlockingConnection bool
	// ClientNameSuffix is appended to the base client name of the dedicated
	// blocking connection, for example ":w:<worker>" or ":qe".
	ClientNameSuffix string
	// BlockTimeout is the longest blocking read the owner will request. It
	// lets the backend size socket read timeouts.
	BlockTimeout time.Duration
}

// BackendFactory builds a [Backend] for the queue called name. It is injected
// through the Backend field of [QueueOptions], [WorkerOptions] and
// [QueueEventsOptions]; when it is nil the Redis backend configured by the
// Redis option is used.
type BackendFactory func(name string, opts BackendOptions) (Backend, error)

// resolveBackend builds the backend for a queue, defaulting to Redis.
func resolveBackend(factory BackendFactory, redis RedisOptions, name string, opts BackendOptions) (Backend, error) {
	if factory == nil {
		factory = RedisBackendFactory(redis)
	}
	return factory(name, opts)
}

// NewJob is a validated job ready to be stored by a [Backend]. Opts is a
// private copy with defaults merged and Timestamp set.
type NewJob struct {
	// Name is the job name handed to the processor.
	Name string
	// Data is the JSON encoded payload.
	Data []byte
	// Opts are the effective job options.
	Opts *JobOptions
}

// JobRecord is the stored representation of a job returned by a [Backend].
type JobRecord struct {
	ID              string
	Name            string
	Data            json.RawMessage
	Opts            *JobOptions
	Progress        Progress
	ReturnValue     json.RawMessage
	Stacktrace      []string
	ParentKey       string
	Parent          *ParentKeys
	ProcessedBy     string
	RepeatJobKey    string
	FailedReason    string
	DeferredFailure string
	Timestamp       int64
	AttemptsMade    int64
	AttemptsStarted int64
	ProcessedOn     int64
	FinishedOn      int64
	StalledCounter  int64
	Priority        int64
	Delay           int64
}

// MoveToActiveOptions are the worker settings needed to fetch a job.
type MoveToActiveOptions struct {
	// Token is the lock token to acquire.
	Token string
	// LockDuration is how long the lock is held.
	LockDuration time.Duration
	// WorkerName is stored on the job as the processing worker.
	WorkerName string
	// Limiter throttles how many jobs may be fetched per window.
	Limiter *RateLimiter
}

// FetchResult is the outcome of [Backend.MoveToActive].
type FetchResult struct {
	// Job is the job that was moved to active, or nil when none was ready.
	Job *JobRecord
	// Wait is how long to wait before the next fetch when Job is nil: the time
	// until the rate limit lifts or the next delayed job comes due. Zero means
	// no hint.
	Wait time.Duration
}

// FailureInfo describes why an attempt failed.
type FailureInfo struct {
	// Reason is the failure message.
	Reason string
	// Stacktrace holds the (already trimmed) failure traces to persist.
	Stacktrace []string
}

// FinishOptions carries the settings needed to move a job to a finished state.
type FinishOptions struct {
	// Token is the lock token held on the job.
	Token string
	// JobOpts are the options of the job being finished.
	JobOpts *JobOptions
	// KeepJobs is the effective removal policy for the target state.
	KeepJobs *RemoveOnFinish
	// LockDuration is the worker lock duration.
	LockDuration time.Duration
	// WorkerName is the name of the worker.
	WorkerName string
	// Limiter is the worker rate limiter.
	Limiter *RateLimiter
	// Metrics enables metrics collection.
	Metrics *MetricsOptions
}

// MoveToDelayedOptions tunes [Backend.MoveToDelayed].
type MoveToDelayedOptions struct {
	// SkipAttempt keeps the attempts counter untouched.
	SkipAttempt bool
	// Failure is recorded on the job when the delay is a retry backoff.
	Failure *FailureInfo
}

// StalledOptions configures [Backend.MoveStalledJobsToWait].
type StalledOptions struct {
	// MaxStalledCount is how many times a job may stall before failing.
	MaxStalledCount int
	// Interval is the stalled check interval.
	Interval time.Duration
}

// JobLock identifies the lock held on an active job.
type JobLock struct {
	JobID string
	Token string
}
