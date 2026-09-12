package bullmq

import (
	"time"

	"github.com/redis/go-redis/v9"
)

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
	// Delay in milliseconds before the job becomes available.
	Delay int64 `json:"delay,omitempty"`
	// Priority; lower values are processed first. 0 means unprioritized.
	Priority int64 `json:"priority,omitempty"`
	// LIFO pushes the job to the front of the wait list.
	LIFO bool `json:"lifo,omitempty"`
	// Attempts is the total number of times the job may be tried.
	Attempts int64 `json:"attempts,omitempty"`
	// Backoff configures the delay between retries.
	Backoff *Backoff `json:"backoff,omitempty"`
	// RemoveOnComplete controls automatic removal of completed jobs.
	RemoveOnComplete *RemoveOnFinish `json:"removeOnComplete,omitempty"`
	// RemoveOnFail controls automatic removal of failed jobs.
	RemoveOnFail *RemoveOnFinish `json:"removeOnFail,omitempty"`
	// KeepLogs limits how many log rows are retained per job.
	KeepLogs int64 `json:"kl,omitempty"`
	// SizeLimit rejects jobs whose serialized data exceeds this many bytes.
	SizeLimit int64 `json:"sizeLimit,omitempty"`
	// Timestamp is the creation time in Unix milliseconds. Defaults to now.
	Timestamp int64 `json:"timestamp,omitempty"`

	// Parent links this job to a parent job.
	Parent *ParentOptions `json:"-"`
	// Deduplication prevents duplicates while the key is alive.
	Deduplication *DeduplicationOptions `json:"de,omitempty"`

	// FailParentOnFailure fails the parent when this job fails.
	FailParentOnFailure bool `json:"fpof,omitempty"`
	// ContinueParentOnFailure unblocks the parent when this job fails.
	ContinueParentOnFailure bool `json:"cpof,omitempty"`
	// IgnoreDependencyOnFailure removes this job from the parent's
	// dependencies when it fails, without failing the parent.
	IgnoreDependencyOnFailure bool `json:"idof,omitempty"`
	// RemoveDependencyOnFailure removes the dependency when this job fails.
	RemoveDependencyOnFailure bool `json:"rdof,omitempty"`
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
	if opts.Delay != 0 {
		merged.Delay = opts.Delay
	}
	if opts.Priority != 0 {
		merged.Priority = opts.Priority
	}
	if opts.LIFO {
		merged.LIFO = true
	}
	if opts.Attempts != 0 {
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
	if opts.KeepLogs != 0 {
		merged.KeepLogs = opts.KeepLogs
	}
	if opts.SizeLimit != 0 {
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
	merged.FailParentOnFailure = merged.FailParentOnFailure || opts.FailParentOnFailure
	merged.ContinueParentOnFailure = merged.ContinueParentOnFailure || opts.ContinueParentOnFailure
	merged.IgnoreDependencyOnFailure = merged.IgnoreDependencyOnFailure || opts.IgnoreDependencyOnFailure
	merged.RemoveDependencyOnFailure = merged.RemoveDependencyOnFailure || opts.RemoveDependencyOnFailure
	return &merged
}
