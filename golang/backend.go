package bullmq

import (
	"context"
	"encoding/json"
	"strings"
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
// implementation lives in the redisbackend subpackage; other datastores are
// plugged in through a [BackendFactory] without any change to Queue, Worker,
// QueueEvents or Job. This package never imports a datastore driver.
//
// Rules for implementations:
//
//   - Methods use only exported domain types. Datastore specifics (Lua
//     scripts, key names, SQL, msgpack encoding, reply parsing) stay private
//     to the implementation.
//   - A backend owns its connection(s). Callers never thread a connection or
//     a transaction through an operation.
//   - Operations that fail because of queue semantics return the sentinel
//     errors of this package (for example [ErrJobNotFound] or
//     [ErrJobLockNotExist]), directly or wrapped in a [ScriptError] whose
//     Code is one of the ErrCode constants (-1 to -11), whatever the datastore
//     reports natively. The shared PostgreSQL commands raise SQLSTATE BM001
//     with the same code in the detail.
//   - All methods must be safe for concurrent use.
//   - Times are Unix milliseconds and durations have millisecond precision,
//     as in every other BullMQ port.
//
// Fetching jobs follows Node's protocol. [Backend.MoveToActive] moves the
// next job to active and locks it with a token chosen by the worker. When no
// job can be fetched, the [FetchResult] says why, so the worker knows how
// long it may sleep. A worker finishing a job can ask for the next one in the
// same operation ([FinishOptions.FetchNext]), which saves a round trip per
// job; the next job is then locked with the same token. Between fetches an
// idle worker blocks in [Backend.WaitForJob].
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
	// used for example as a flow parent reference. Redis: `{prefix}:{queue}`;
	// backends without a prefix (PostgreSQL) return the bare queue name, as
	// Node does.
	QualifiedName() string

	// ResolveParent resolves the parent a job is added under into the
	// identifiers the backend persists, without touching the datastore. It
	// returns the parent reference and the backend-specific parent key
	// (Redis: `{prefix}:{queue}:{id}`), matching what fetching the job later
	// reports as [JobRecord.Parent] and [JobRecord.ParentKey].
	ResolveParent(parent *ParentOptions) (*ParentKeys, string, error)

	// ClientName builds the connection name used for worker discovery. Redis:
	// `{prefix}:{base64(queue)}{suffix}`; PostgreSQL: `{queue}{suffix}`.
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

	// MoveToActive atomically moves the next eligible job to active, locks
	// it with opts.Token for opts.LockDuration and returns it. When no job can
	// be fetched it returns a result with a nil Job and the reason, as
	// described on [FetchResult]. It never blocks waiting for a job.
	MoveToActive(ctx context.Context, opts MoveToActiveOptions) (*FetchResult, error)

	// MoveToCompleted moves an active job owned by opts.Token to completed
	// and records returnValue. When opts.FetchNext is set it then fetches the
	// next job exactly as MoveToActive would, locked with the same token, and
	// reports it in [FinishResult.Next].
	MoveToCompleted(ctx context.Context, jobID string, returnValue []byte, opts FinishOptions) (*FinishResult, error)

	// MoveToFailed moves an active job owned by opts.Token to failed and
	// records failure. Fetching the next job works as in MoveToCompleted.
	MoveToFailed(ctx context.Context, jobID string, failure FailureInfo, opts FinishOptions) (*FinishResult, error)

	// MoveToDelayed reschedules an active job owned by token to run after
	// delay. When opts.FetchNext is set it then tries to fetch the next job,
	// locked with the same token, and returns the outcome; otherwise it
	// returns nil. Unlike the finishing operations it may report only a
	// fetched job, without the rate-limit or delayed-job hints (Redis does
	// so), so a result with a nil Job means "fetch again", not "drained".
	MoveToDelayed(ctx context.Context, jobID, token string, delay time.Duration, opts MoveToDelayedOptions) (*FetchResult, error)

	// MoveJobFromActiveToWait puts an active job back in the wait list (or
	// the prioritized set, keeping its priority) without counting an attempt,
	// and releases its lock. Workers use it when a processor reports that the
	// queue is rate limited. An empty token skips the lock check, as Node's
	// default token "0" does. It returns the remaining rate-limit time, or 0
	// when the queue is not rate limited.
	MoveJobFromActiveToWait(ctx context.Context, jobID, token string) (time.Duration, error)

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

	// SetRateLimit rate limits the whole queue for ttl, as if the limiter's
	// window were full: until it expires, fetching reports a rate limit
	// instead of a job. Like the shared commands, the limit only applies to
	// fetches made with a limiter (a worker Limiter or a global rate limit).
	// ttl must be at least 1ms.
	SetRateLimit(ctx context.Context, ttl time.Duration) error

	// GetMetrics returns the metrics collected for the completed or failed
	// state.
	GetMetrics(ctx context.Context, state JobState, start, end int64) (*Metrics, error)

	// GetClientList returns the connection list(s) of the datastore, used
	// for worker discovery, in the `CLIENT LIST` format: one string per
	// server (a cluster has several), with one connection per line as
	// space-separated key=value fields, including `name`. Queue.Workers
	// parses them. Redis returns CLIENT LIST itself; other backends report
	// their named connections as `name=<name>` lines (PostgreSQL: one per
	// application_name), or nothing.
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

	// LastEventID returns the id of the newest event, or "0-0" when there is
	// none (the Redis stream syntax, which other backends reuse for "before
	// the first event"). Reading from it only yields events produced
	// afterwards. Event ids are opaque to callers.
	LastEventID(ctx context.Context) (string, error)

	// ReadEvents blocks up to block waiting for events newer than lastID. It
	// returns no events when the wait times out.
	ReadEvents(ctx context.Context, lastID string, block time.Duration) ([]QueueEvent, error)

	// WaitForJob blocks up to timeout until the queue signals that a job may
	// be available or that a delayed job was scheduled, then reports it in a
	// [WaitResult]. A timeout is not an error: it returns a zero WaitResult.
	// When ctx is done it returns promptly with ctx's error. It uses the
	// connection dedicated to blocking reads.
	//
	// A backend MAY return early, with or without Woken, for example when a
	// signal was meant for another worker or its blocking primitive cannot
	// wait that long. The caller must cope by fetching again (and finding
	// nothing) or waiting again; it must never rely on WaitForJob for timing.
	//
	// Workers may call it while some of their jobs are still being processed,
	// so it must not report work that cannot be claimed, for example while
	// the queue is paused or at its global concurrency limit.
	WaitForJob(ctx context.Context, timeout time.Duration) (WaitResult, error)

	// ------------------------------------------------------------------
	// Flows
	// ------------------------------------------------------------------

	// ForQueue returns a backend for another queue of the same namespace
	// that shares this backend's connections, as Node's forQueue does.
	// [FlowProducer] uses it to reach every queue of a flow over one
	// connection. name is a bare queue name or a qualified name as returned
	// by QualifiedName. The returned backend does not own the connections:
	// closing it releases only what it opened itself, and it stops working
	// once this backend is closed.
	ForQueue(name string) (Backend, error)

	// AddFlow inserts the jobs of one or more flows in a single operation (a
	// Redis transaction, a single SQL statement) and returns their ids in
	// order. Each entry names its own queue, which may differ from this
	// backend's. Entries are ordered so that a parent comes before its
	// children, and a parent is released from waiting-children only once the
	// whole tree has been inserted, if none of its children is pending.
	//
	// When the datastore rejects an entry, for example because its parent
	// does not exist ([ErrParentJobNotExist]) or because the job already
	// exists under another parent ([ErrParentJobCannotBeReplaced]), AddFlow
	// returns an error for the first rejected entry. Entries the datastore
	// accepted are kept: neither Redis nor the shared SQL rolls them back.
	AddFlow(ctx context.Context, entries []FlowEntry) ([]string, error)

	// GetDependencies returns the children of a parent job grouped by
	// status, identified by their keys (`{QualifiedName}:{id}`). With nil
	// opts every group is returned in full; otherwise only the requested
	// groups are, one page each, with the cursor of the next page.
	GetDependencies(ctx context.Context, jobID string, opts *DependenciesOptions) (*Dependencies, error)

	// GetDependencyCounts returns how many children of a parent job are in
	// each status.
	GetDependencyCounts(ctx context.Context, jobID string) (DependencyCounts, error)

	// GetProcessedChildrenValues returns the return value (JSON) of every
	// completed child of a parent job, by child key.
	GetProcessedChildrenValues(ctx context.Context, jobID string) (map[string]json.RawMessage, error)

	// GetIgnoredChildrenFailures returns the failure reason of every child
	// of a parent job whose failure was ignored (IgnoreDependencyOnFailure or
	// ContinueParentOnFailure), by child key.
	GetIgnoredChildrenFailures(ctx context.Context, jobID string) (map[string]string, error)

	// RemoveChildDependency detaches a job that has not finished yet from
	// the parent stored under parentKey (see [JobRecord.ParentKey]), and
	// moves the parent to wait when it was its last pending child. It
	// returns false when there was no such dependency, [ErrJobNotFound] when
	// the job does not exist and [ErrParentJobNotExist] when the parent does
	// not.
	RemoveChildDependency(ctx context.Context, jobID, parentKey string) (bool, error)

	// RemoveUnprocessedChildren removes, recursively, the children of a
	// parent job that have not been processed yet. Active, completed and
	// failed children, and locked ones, are kept.
	RemoveUnprocessedChildren(ctx context.Context, jobID string) error

	// ------------------------------------------------------------------
	// Job schedulers
	// ------------------------------------------------------------------

	// AddJobScheduler creates the job scheduler s.ID, or replaces its
	// schedule and template, and adds the job of its next iteration,
	// removing the pending job of the previous one. For Every schedulers
	// the backend computes the next iteration itself. It returns the id of
	// the added job and its delay in milliseconds. It fails with
	// [ErrSchedulerJobIDCollision] when a job of a Pattern scheduler with
	// that id already exists, and with [ErrSchedulerJobSlotsBusy] when no
	// free slot was found for an Every scheduler.
	AddJobScheduler(ctx context.Context, s NewJobScheduler) (string, int64, error)

	// UpdateJobSchedulerNextMillis advances the job scheduler schedulerID
	// to the iteration due at nextMillis (computed by the backend for Every
	// schedulers) and adds its job, with options jobOpts and the stored
	// template data (templateData is a fallback). Only the job of the
	// current iteration, producerID, may advance it. It returns the id of
	// the added job, or "" when none was added: the scheduler is gone,
	// producerID is not the current iteration, or the job already exists
	// (a `duplicated` event is then emitted).
	UpdateJobSchedulerNextMillis(ctx context.Context, schedulerID string, nextMillis int64, templateData []byte, jobOpts *JobOptions, producerID string) (string, error)

	// RemoveJobScheduler removes a job scheduler and the job of its next
	// iteration while that job is still delayed. It reports whether the
	// scheduler existed.
	RemoveJobScheduler(ctx context.Context, schedulerID string) (bool, error)

	// GetJobScheduler returns a job scheduler with the due time of its next
	// job, or nil when it does not exist or has no stored metadata.
	GetJobScheduler(ctx context.Context, schedulerID string) (*JobScheduler, error)

	// GetJobSchedulersRange returns the job schedulers ranked start to end
	// (inclusive; a negative end counts from the last one) by the due time
	// of their next job, latest first unless asc is set.
	GetJobSchedulersRange(ctx context.Context, start, end int64, asc bool) ([]JobSchedulerNext, error)

	// GetJobSchedulersCount returns the number of job schedulers.
	GetJobSchedulersCount(ctx context.Context) (int64, error)

	// IsJobScheduler reports whether id is a job scheduler, as opposed to a
	// legacy repeatable job, which this port does not support.
	IsJobScheduler(ctx context.Context, id string) (bool, error)
}

// BackendOptions describes the role of the backend being built by a
// [BackendFactory]. Datastore settings such as addresses, credentials or a
// Redis key prefix belong to the options of the backend package itself.
type BackendOptions struct {
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
// through the required Backend field of [QueueOptions], [WorkerOptions] and
// [QueueEventsOptions], for example with redisbackend.New. The queue name has
// already been validated when the factory is called.
type BackendFactory func(name string, opts BackendOptions) (Backend, error)

// resolveBackend validates the queue name and builds its backend.
func resolveBackend(factory BackendFactory, name string, opts BackendOptions) (Backend, error) {
	if factory == nil {
		return nil, configError("a Backend is required, for example redisbackend.New(redisbackend.Options{})")
	}
	if err := validateQueueName(name); err != nil {
		return nil, err
	}
	b, err := factory(name, opts)
	if err != nil {
		return nil, err
	}
	if b == nil {
		return nil, configError("the Backend factory returned no backend")
	}
	return b, nil
}

// validateQueueName applies the queue name rules shared by every backend and
// language port.
func validateQueueName(name string) error {
	if name == "" {
		return configError("queue name must be provided")
	}
	if strings.Contains(name, ":") {
		return configError("queue name cannot contain ':'")
	}
	return nil
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

// FetchResult is the outcome of fetching a job, with [Backend.MoveToActive]
// or as the next job of a finishing operation. It mirrors the
// `[jobData, id, rateLimitDelay, delayUntil]` tuple of the other ports.
//
// When Job is nil, the other fields say why no job was fetched:
//
//   - RateLimitDelay > 0: the queue is rate limited for that long, and no
//     job may be fetched before it lifts.
//   - NextDelayedAt > 0: nothing is ready, but a delayed job is due then.
//   - both zero: the queue is empty, paused or at its global concurrency
//     limit.
type FetchResult struct {
	// Job is the job that was moved to active, or nil when none was fetched.
	Job *JobRecord
	// RateLimitDelay is how long the queue stays rate limited when Job is nil
	// because of the rate limit.
	RateLimitDelay time.Duration
	// NextDelayedAt is when the next delayed job is due (Unix milliseconds)
	// when Job is nil; 0 means none, or unknown.
	NextDelayedAt int64
}

// FinishResult is the outcome of [Backend.MoveToCompleted] and
// [Backend.MoveToFailed].
type FinishResult struct {
	// FinishedOn is the recorded finishedOn timestamp (Unix milliseconds).
	FinishedOn int64
	// Next is the outcome of fetching the next job. It is nil when
	// [FinishOptions.FetchNext] was not set, so callers can tell "not
	// requested" from "nothing to fetch" (a non-nil result with a nil Job).
	Next *FetchResult
}

// WaitResult is the outcome of [Backend.WaitForJob].
type WaitResult struct {
	// Woken is true when the wait ended because the queue signalled work,
	// and false when it timed out. Signals may be spurious.
	Woken bool
	// NextDelayedAt is when the next delayed job is due (Unix milliseconds),
	// when the signal says so; 0 means a job may be ready now, or unknown.
	NextDelayedAt int64
}

// FailureInfo describes why an attempt failed.
type FailureInfo struct {
	// Reason is the failure message.
	Reason string
	// Stacktrace holds the (already trimmed) failure traces to persist.
	Stacktrace []string
}

// FinishOptions carries the settings needed to move a job to a finished state
// and, optionally, to fetch the next one.
type FinishOptions struct {
	// Token is the lock token held on the job. The next job, when fetched,
	// is locked with the same token.
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
	// FetchNext fetches the next job in the same operation, as MoveToActive
	// would with Token, LockDuration, WorkerName and Limiter.
	FetchNext bool
}

// MoveToDelayedOptions tunes [Backend.MoveToDelayed].
type MoveToDelayedOptions struct {
	// SkipAttempt keeps the attempts counter untouched.
	SkipAttempt bool
	// Failure is recorded on the job when the delay is a retry backoff.
	Failure *FailureInfo
	// FetchNext fetches the next job in the same operation, as MoveToActive
	// would with the job's token and the settings below.
	FetchNext bool
	// LockDuration is how long the next job's lock is held.
	LockDuration time.Duration
	// WorkerName is stored on the next job as the processing worker.
	WorkerName string
	// Limiter throttles fetching the next job.
	Limiter *RateLimiter
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
