package bullmq

import (
	"time"

	"github.com/redis/go-redis/v9"
)

// Int64 returns a pointer to n, for use with pointer-typed JobOptions fields
// such as Delay.
func Int64(n int64) *int64 { return &n }

// Bool returns a pointer to b, for use with pointer-typed JobOptions fields
// such as LIFO.
func Bool(b bool) *bool { return &b }

// ParentOptions links a job to a parent job, possibly in another queue.
type ParentOptions struct {
	// ID is the parent job id.
	ID string `json:"id"`
	// Queue is the parent queue. Either a bare queue name or a fully
	// qualified `{prefix}:{queueName}` key.
	Queue string `json:"queue"`
}

// DeduplicationOptions prevents duplicate jobs from being added while a
// deduplication key is alive.
type DeduplicationOptions struct {
	// ID is the deduplication key.
	ID string `json:"id"`
	// TTL is how long, in milliseconds, the key stays alive.
	TTL int64 `json:"ttl,omitempty"`
	// Extend refreshes the TTL when a duplicate is discarded.
	Extend bool `json:"extend,omitempty"`
	// Replace discards the existing job in favour of the new one.
	Replace bool `json:"replace,omitempty"`
}

// JobOptions configures a single job.
//
// The JSON tags mirror the field names persisted in Redis by the shared Lua
// commands, so options round-trip across all BullMQ language ports.
type JobOptions struct {
	// JobID overrides the automatically generated job id.
	JobID string `json:"jobId,omitempty"`
	// Delay in milliseconds before the job becomes available. A pointer so a
	// per-job value of 0 can be told apart from "not set", letting it override
	// a non-zero queue default back to 0.
	Delay *int64 `json:"delay,omitempty"`
	// Priority; lower values are processed first. 0 means unprioritized. A
	// pointer so a per-job value of 0 can be told apart from "not set",
	// letting it override a non-zero queue default back to 0.
	Priority *int64 `json:"priority,omitempty"`
	// LIFO pushes the job to the front of the wait list. A pointer so an
	// explicit `false` can override a queue default of `true`.
	LIFO *bool `json:"lifo,omitempty"`
	// Attempts is the total number of times the job may be tried. A pointer
	// so a per-job value of 0 can override a non-zero queue default.
	Attempts *int64 `json:"attempts,omitempty"`
	// Backoff configures the delay between retries.
	Backoff *Backoff `json:"backoff,omitempty"`
	// RemoveOnComplete controls automatic removal of completed jobs.
	RemoveOnComplete *RemoveOnFinish `json:"removeOnComplete,omitempty"`
	// RemoveOnFail controls automatic removal of failed jobs.
	RemoveOnFail *RemoveOnFinish `json:"removeOnFail,omitempty"`
	// KeepLogs limits how many log rows are retained per job. A pointer so a
	// per-job value of 0 can override a non-zero queue default.
	KeepLogs *int64 `json:"kl,omitempty"`
	// SizeLimit rejects jobs whose serialized data exceeds this many bytes. A
	// pointer so a per-job value of 0 can override a non-zero queue default.
	SizeLimit *int64 `json:"sizeLimit,omitempty"`
	// Timestamp is the creation time in Unix milliseconds. Defaults to now.
	Timestamp int64 `json:"timestamp,omitempty"`

	// Parent links this job to a parent job.
	Parent *ParentOptions `json:"-"`
	// Deduplication prevents duplicates while the key is alive.
	Deduplication *DeduplicationOptions `json:"de,omitempty"`

	// FailParentOnFailure fails the parent when this job fails. A pointer so
	// an explicit `false` can override a queue default of `true`.
	FailParentOnFailure *bool `json:"fpof,omitempty"`
	// ContinueParentOnFailure unblocks the parent when this job fails. A
	// pointer so an explicit `false` can override a queue default of `true`.
	ContinueParentOnFailure *bool `json:"cpof,omitempty"`
	// IgnoreDependencyOnFailure removes this job from the parent's
	// dependencies when it fails, without failing the parent. A pointer so
	// an explicit `false` can override a queue default of `true`.
	IgnoreDependencyOnFailure *bool `json:"idof,omitempty"`
	// RemoveDependencyOnFailure removes the dependency when this job fails. A
	// pointer so an explicit `false` can override a queue default of `true`.
	RemoveDependencyOnFailure *bool `json:"rdof,omitempty"`
}

// RedisOptions describes how to reach the Redis server.
//
// Set Client to reuse an existing go-redis client; otherwise Addr and the
// remaining fields are used to build one.
type RedisOptions struct {
	// Client is an existing client to reuse. When set every other field is ignored.
	Client redis.UniversalClient
	// Addr is the `host:port` of the Redis server. Defaults to 127.0.0.1:6379.
	Addr string
	// Username for ACL authentication.
	Username string
	// Password for authentication.
	Password string
	// DB is the database index.
	DB int
	// PoolSize is the maximum number of pooled connections.
	PoolSize int
}

func (o RedisOptions) build() (redis.UniversalClient, bool) {
	if o.Client != nil {
		return o.Client, false
	}
	addr := o.Addr
	if addr == "" {
		addr = "127.0.0.1:6379"
	}
	return redis.NewClient(&redis.Options{
		Addr:     addr,
		Username: o.Username,
		Password: o.Password,
		DB:       o.DB,
		PoolSize: o.PoolSize,
	}), true
}

// QueueOptions configures a Queue.
type QueueOptions struct {
	// Redis describes the connection to use.
	Redis RedisOptions
	// Prefix overrides the default `bull` key prefix.
	Prefix string
	// DefaultJobOptions are merged into every job added to this queue.
	DefaultJobOptions *JobOptions
}

// WorkerOptions configures a Worker.
type WorkerOptions struct {
	// Redis describes the connection to use.
	Redis RedisOptions
	// Prefix overrides the default `bull` key prefix.
	Prefix string
	// Name identifies the worker; stored on each processed job as `pb`.
	Name string
	// Concurrency is the number of jobs processed in parallel. Defaults to 1.
	Concurrency int
	// LockDuration is how long a job lock is held. Defaults to 30s.
	LockDuration time.Duration
	// LockRenewTime is how often the lock is renewed. Defaults to LockDuration/2.
	LockRenewTime time.Duration
	// StalledInterval is how often stalled jobs are checked. Defaults to 30s.
	StalledInterval time.Duration
	// MaxStalledCount is how many times a job may stall before failing. Defaults to 1.
	MaxStalledCount int
	// SkipStalledCheck disables the stalled job checker.
	SkipStalledCheck bool
	// SkipLockRenewal disables automatic lock renewal.
	SkipLockRenewal bool
	// DrainDelay is how long a blocking fetch waits for new jobs. Defaults to 5s.
	DrainDelay time.Duration
	// Limiter throttles job processing.
	Limiter *RateLimiter
	// Metrics enables completed/failed metrics collection.
	Metrics *MetricsOptions
	// RemoveOnComplete is the default removal policy for completed jobs.
	RemoveOnComplete *RemoveOnFinish
	// RemoveOnFail is the default removal policy for failed jobs.
	RemoveOnFail *RemoveOnFinish
	// BackoffStrategy computes a custom retry delay in milliseconds. Returning
	// a negative value discards the job.
	BackoffStrategy func(attemptsMade int64, backoffType BackoffType, err error, job *Job) int64
	// OnError is called for background errors that cannot be returned to a caller.
	OnError func(err error)
}

func (o *WorkerOptions) applyDefaults() {
	if o.Concurrency <= 0 {
		o.Concurrency = 1
	}
	if o.LockDuration <= 0 {
		o.LockDuration = 30 * time.Second
	}
	if o.LockRenewTime <= 0 {
		o.LockRenewTime = o.LockDuration / 2
	}
	if o.StalledInterval <= 0 {
		o.StalledInterval = 30 * time.Second
	}
	if o.MaxStalledCount <= 0 {
		o.MaxStalledCount = 1
	}
	if o.DrainDelay <= 0 {
		o.DrainDelay = 5 * time.Second
	}
}

// QueueEventsOptions configures a QueueEvents listener.
type QueueEventsOptions struct {
	// Redis describes the connection to use.
	Redis RedisOptions
	// Prefix overrides the default `bull` key prefix.
	Prefix string
	// LastEventID is the stream id to start reading from. Defaults to `$`
	// (only events produced after the listener starts).
	LastEventID string
	// BlockingTimeout is how long each XREAD call blocks. Defaults to 5s.
	BlockingTimeout time.Duration
	// BufferSize is the size of the delivery channel. Defaults to 128.
	BufferSize int
}

// delayMs returns the configured delay in milliseconds, or 0 if opts is nil
// or Delay was never set.
func (opts *JobOptions) delayMs() int64 {
	if opts == nil || opts.Delay == nil {
		return 0
	}
	return *opts.Delay
}

// isLIFO reports whether the job should be pushed to the front of the wait
// list, treating an unset LIFO as false.
func (opts *JobOptions) isLIFO() bool {
	return opts != nil && opts.LIFO != nil && *opts.LIFO
}

// priorityVal returns the configured priority, or 0 if opts is nil or
// Priority was never set.
func (opts *JobOptions) priorityVal() int64 {
	if opts == nil || opts.Priority == nil {
		return 0
	}
	return *opts.Priority
}

// attemptsVal returns the configured attempts, or 0 if opts is nil or
// Attempts was never set.
func (opts *JobOptions) attemptsVal() int64 {
	if opts == nil || opts.Attempts == nil {
		return 0
	}
	return *opts.Attempts
}

// keepLogsVal returns the configured KeepLogs, or 0 if opts is nil or
// KeepLogs was never set.
func (opts *JobOptions) keepLogsVal() int64 {
	if opts == nil || opts.KeepLogs == nil {
		return 0
	}
	return *opts.KeepLogs
}

// sizeLimitVal returns the configured SizeLimit, or 0 if opts is nil or
// SizeLimit was never set.
func (opts *JobOptions) sizeLimitVal() int64 {
	if opts == nil || opts.SizeLimit == nil {
		return 0
	}
	return *opts.SizeLimit
}

// failParentOnFailureVal reports whether the parent should be failed when
// this job fails, treating an unset value as false.
func (opts *JobOptions) failParentOnFailureVal() bool {
	return opts != nil && opts.FailParentOnFailure != nil && *opts.FailParentOnFailure
}

// continueParentOnFailureVal reports whether the parent should be unblocked
// when this job fails, treating an unset value as false.
func (opts *JobOptions) continueParentOnFailureVal() bool {
	return opts != nil && opts.ContinueParentOnFailure != nil && *opts.ContinueParentOnFailure
}

// ignoreDependencyOnFailureVal reports whether this job should be removed
// from the parent's dependencies on failure, treating an unset value as false.
func (opts *JobOptions) ignoreDependencyOnFailureVal() bool {
	return opts != nil && opts.IgnoreDependencyOnFailure != nil && *opts.IgnoreDependencyOnFailure
}

// removeDependencyOnFailureVal reports whether the dependency should be
// removed when this job fails, treating an unset value as false.
func (opts *JobOptions) removeDependencyOnFailureVal() bool {
	return opts != nil && opts.RemoveDependencyOnFailure != nil && *opts.RemoveDependencyOnFailure
}

// mergeJobOptions returns opts with any unset field filled in from defaults.
func mergeJobOptions(opts, defaults *JobOptions) *JobOptions {
	if defaults == nil {
		if opts == nil {
			return &JobOptions{}
		}
		clone := *opts
		return &clone
	}
	merged := *defaults
	// The job id and parent are never inherited from queue defaults.
	merged.JobID = ""
	merged.Parent = nil
	merged.Deduplication = nil
	merged.Timestamp = 0

	if opts == nil {
		return &merged
	}
	if opts.JobID != "" {
		merged.JobID = opts.JobID
	}
	// Delay, Priority, LIFO, Attempts, KeepLogs and SizeLimit are pointers
	// specifically so a per-job value that is present but zero/false can
	// still override a non-zero/true queue default; only a nil pointer
	// (option omitted) falls back to the default.
	if opts.Delay != nil {
		merged.Delay = opts.Delay
	}
	if opts.Priority != nil {
		merged.Priority = opts.Priority
	}
	if opts.LIFO != nil {
		merged.LIFO = opts.LIFO
	}
	if opts.Attempts != nil {
		merged.Attempts = opts.Attempts
	}
	if opts.Backoff != nil {
		merged.Backoff = opts.Backoff
	}
	if opts.RemoveOnComplete != nil {
		merged.RemoveOnComplete = opts.RemoveOnComplete
	}
	if opts.RemoveOnFail != nil {
		merged.RemoveOnFail = opts.RemoveOnFail
	}
	if opts.KeepLogs != nil {
		merged.KeepLogs = opts.KeepLogs
	}
	if opts.SizeLimit != nil {
		merged.SizeLimit = opts.SizeLimit
	}
	if opts.Timestamp != 0 {
		merged.Timestamp = opts.Timestamp
	}
	if opts.Parent != nil {
		merged.Parent = opts.Parent
	}
	if opts.Deduplication != nil {
		merged.Deduplication = opts.Deduplication
	}
	// The four dependency-on-failure flags are pointers so a per-job value
	// of `false` can override a queue default of `true`; only a nil pointer
	// (option omitted) falls back to the default.
	if opts.FailParentOnFailure != nil {
		merged.FailParentOnFailure = opts.FailParentOnFailure
	}
	if opts.ContinueParentOnFailure != nil {
		merged.ContinueParentOnFailure = opts.ContinueParentOnFailure
	}
	if opts.IgnoreDependencyOnFailure != nil {
		merged.IgnoreDependencyOnFailure = opts.IgnoreDependencyOnFailure
	}
	if opts.RemoveDependencyOnFailure != nil {
		merged.RemoveDependencyOnFailure = opts.RemoveDependencyOnFailure
	}
	return &merged
}
