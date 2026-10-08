package bullmq

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Queue adds jobs to a BullMQ queue and inspects its contents.
//
// A Queue only depends on the [Backend] abstraction, so it works with any
// datastore for which a backend exists. By default it uses Redis.
//
// A Queue is safe for concurrent use.
type Queue struct {
	backend           Backend
	defaultJobOptions *JobOptions
}

// priorityLimit is the largest accepted priority (2^21-1). The shared scripts
// compute scores as priority * 2^32 + counter, so larger values would exceed
// the exact integer range of Redis/Lua and lose the counter.
const priorityLimit int64 = 1<<21 - 1

// NewQueue creates a queue named name.
func NewQueue(name string, opts *QueueOptions) (*Queue, error) {
	if opts == nil {
		opts = &QueueOptions{}
	}
	backend, err := resolveBackend(opts.Backend, opts.Redis, name, BackendOptions{Prefix: opts.Prefix})
	if err != nil {
		return nil, err
	}
	return &Queue{backend: backend, defaultJobOptions: opts.DefaultJobOptions}, nil
}

// Name returns the queue name.
func (q *Queue) Name() string { return q.backend.QueueName() }

// Backend returns the datastore backend used by the queue.
func (q *Queue) Backend() Backend { return q.backend }

// Keys exposes the key generator used by the queue. It returns nil when the
// queue does not use the Redis backend.
func (q *Queue) Keys() *Keys {
	if rb, ok := q.backend.(*RedisBackend); ok {
		return rb.Keys()
	}
	return nil
}

// Client returns the underlying Redis client. It returns nil when the queue
// does not use the Redis backend.
func (q *Queue) Client() redis.UniversalClient {
	if rb, ok := q.backend.(*RedisBackend); ok {
		return rb.Client()
	}
	return nil
}

// Close releases the connections the queue owns.
func (q *Queue) Close() error { return q.backend.Close() }

// JobSpec describes a job to add through Add or AddBulk.
type JobSpec struct {
	// Name is the job name handed to the processor.
	Name string
	// Data is the payload; it is marshalled to JSON.
	Data any
	// Opts overrides the queue default job options.
	Opts *JobOptions
}

// Add inserts a single job into the queue.
func (q *Queue) Add(ctx context.Context, name string, data any, opts *JobOptions) (*Job, error) {
	nj, err := q.prepareJob(JobSpec{Name: name, Data: data, Opts: opts})
	if err != nil {
		return nil, err
	}
	id, err := q.backend.AddJob(ctx, nj)
	if err != nil {
		return nil, err
	}
	return q.newAddedJob(id, nj), nil
}

// AddBulk inserts every job in one backend operation. For Redis that is a
// single transaction, but Redis does not roll back earlier scripts when a
// later script returns an application-level error, so a failed batch may
// contain jobs that were inserted before the failing command.
func (q *Queue) AddBulk(ctx context.Context, specs []JobSpec) ([]*Job, error) {
	if len(specs) == 0 {
		return nil, nil
	}

	prepared := make([]NewJob, len(specs))
	for i, spec := range specs {
		nj, err := q.prepareJob(spec)
		if err != nil {
			return nil, err
		}
		prepared[i] = nj
	}

	ids, err := q.backend.AddJobs(ctx, prepared)
	if err != nil {
		return nil, err
	}
	if len(ids) != len(prepared) {
		return nil, configError("backend returned %d job ids for %d jobs", len(ids), len(prepared))
	}

	jobs := make([]*Job, len(prepared))
	for i, nj := range prepared {
		jobs[i] = q.newAddedJob(ids[i], nj)
	}
	return jobs, nil
}

// newAddedJob builds the Job returned to the caller of Add or AddBulk.
func (q *Queue) newAddedJob(id string, nj NewJob) *Job {
	return &Job{
		ID:        id,
		Name:      nj.Name,
		Data:      nj.Data,
		Opts:      nj.Opts,
		Timestamp: nj.Opts.Timestamp,
		Delay:     nj.Opts.delayMs(),
		Priority:  nj.Opts.priorityVal(),
		QueueName: q.Name(),
		backend:   q.backend,
	}
}

// prepareJob validates a JobSpec, merges the queue defaults and serializes the
// payload. It never touches the datastore.
func (q *Queue) prepareJob(spec JobSpec) (NewJob, error) {
	opts := mergeJobOptions(spec.Opts, q.defaultJobOptions)
	if opts.JobID != "" {
		if opts.JobID == "0" || strings.HasPrefix(opts.JobID, "0:") {
			return NewJob{}, configError("job ID cannot be '0' or start with '0:'")
		}
		if n, err := strconv.ParseInt(opts.JobID, 10, 64); err == nil && strconv.FormatInt(n, 10) == opts.JobID {
			return NewJob{}, configError("custom job ID cannot be an integer")
		}
		if strings.Contains(opts.JobID, ":") && len(strings.Split(opts.JobID, ":")) != 3 {
			return NewJob{}, configError("custom job ID cannot contain ':'")
		}
	}
	if priority := opts.priorityVal(); priority < 0 || priority > priorityLimit {
		return NewJob{}, configError("priority should be between 0 and %d", priorityLimit)
	}
	if opts.Backoff != nil {
		if err := opts.Backoff.validate(); err != nil {
			return NewJob{}, err
		}
	}
	if opts.Parent != nil {
		enabled := 0
		for _, v := range []bool{
			opts.failParentOnFailureVal(), opts.ignoreDependencyOnFailureVal(),
			opts.removeDependencyOnFailureVal(), opts.continueParentOnFailureVal(),
		} {
			if v {
				enabled++
			}
		}
		if enabled > 1 {
			return NewJob{}, configError("parent failure options are mutually exclusive")
		}
	}
	if opts.Deduplication != nil {
		if opts.Deduplication.ID == "" {
			return NewJob{}, configError("deduplication ID must be provided")
		}
		if opts.Parent != nil {
			return NewJob{}, configError("deduplication and parent options cannot be used together")
		}
	}

	payload, err := json.Marshal(spec.Data)
	if err != nil {
		return NewJob{}, err
	}
	if opts.sizeLimitVal() > 0 && int64(len(payload)) > opts.sizeLimitVal() {
		return NewJob{}, configError("job data exceeds sizeLimit of %d bytes (was %d)",
			opts.sizeLimitVal(), len(payload))
	}

	// opts is a private copy, so record the effective timestamp in it; it is
	// persisted in the stored opts and returned in Job.Opts.
	if opts.Timestamp == 0 {
		opts.Timestamp = nowMillis()
	}

	return NewJob{Name: spec.Name, Data: payload, Opts: opts}, nil
}

// Job fetches a job by id. It returns nil when the job does not exist.
func (q *Queue) Job(ctx context.Context, jobID string) (*Job, error) {
	rec, err := q.backend.GetJob(ctx, jobID)
	if err != nil || rec == nil {
		return nil, err
	}
	return newJob(q.backend, rec), nil
}

// JobState returns the state of a job.
func (q *Queue) JobState(ctx context.Context, jobID string) (JobState, error) {
	return q.backend.GetState(ctx, jobID)
}

// Pause stops workers from picking up new jobs. Jobs already active keep running.
func (q *Queue) Pause(ctx context.Context) error {
	return q.backend.Pause(ctx, true)
}

// Resume lets workers pick up jobs again.
func (q *Queue) Resume(ctx context.Context) error {
	return q.backend.Pause(ctx, false)
}

// IsPaused reports whether the queue is paused.
func (q *Queue) IsPaused(ctx context.Context) (bool, error) {
	val, ok, err := q.backend.GetQueueMetaField(ctx, "paused")
	if err != nil || !ok {
		return false, err
	}
	return val != "" && val != "0", nil
}

// Drain removes all waiting and prioritized jobs. Active, completed and failed
// jobs are left untouched. When delayed is true, delayed jobs are removed too.
func (q *Queue) Drain(ctx context.Context, delayed bool) error {
	return q.backend.Drain(ctx, delayed)
}

// Obliterate deletes the queue and every job in it.
//
// The queue is paused first, matching the behaviour of the other ports. When
// force is false the call fails if there are still active jobs.
func (q *Queue) Obliterate(ctx context.Context, force bool, count int64) error {
	if count <= 0 {
		count = 1000
	}
	if err := q.Pause(ctx); err != nil {
		return err
	}
	for {
		remaining, err := q.backend.Obliterate(ctx, force, count)
		if err != nil {
			return err
		}
		if remaining <= 0 {
			return nil
		}
	}
}

// cleanableStates are the states accepted by Clean.
var cleanableStates = map[JobState]bool{
	JobState("wait"): true,
	StateWaiting:     true,
	StateActive:      true,
	StatePrioritized: true,
	StateDelayed:     true,
	StateCompleted:   true,
	StateFailed:      true,
	"paused":         true,
}

// cleanMaxBatch bounds how many jobs a single CleanJobsByState call may
// remove. The operation runs atomically, so an unbounded call on a large state
// could block every client; this matches the reference implementation.
const cleanMaxBatch int64 = 10000

// Clean removes finished (or waiting/delayed) jobs older than grace.
//
// state must be one of wait, active, paused, prioritized, delayed, completed or
// failed. A limit of 0 means unlimited. Removal runs in batches of at most
// 10,000 jobs, repeating until limit jobs were removed or a batch comes back
// short, so a large state never blocks the datastore in a single call. It
// returns the removed job ids.
func (q *Queue) Clean(ctx context.Context, grace time.Duration, limit int64, state JobState) ([]string, error) {
	if !cleanableStates[state] {
		return nil, configError("clean state must be one of wait, active, paused, prioritized, delayed, completed or failed, got %q", state)
	}
	timestamp := nowMillis() - grace.Milliseconds()

	ids := make([]string, 0)
	for limit == 0 || int64(len(ids)) < limit {
		batch := cleanMaxBatch
		if limit > 0 {
			batch = min(batch, limit-int64(len(ids)))
		}
		removed, err := q.backend.CleanJobsByState(ctx, state, timestamp, batch)
		if err != nil {
			return ids, err
		}
		ids = append(ids, removed...)
		if int64(len(removed)) < batch {
			break
		}
	}
	return ids, nil
}

// RetryJobs moves completed or failed jobs back to the wait list, looping
// until every eligible job has been moved.
func (q *Queue) RetryJobs(ctx context.Context, state JobState, count int64) (int64, error) {
	if state != StateCompleted && state != StateFailed {
		return 0, configError("retry state must be %q or %q", StateCompleted, StateFailed)
	}
	if count <= 0 {
		count = 1000
	}
	timestamp := nowMillis()
	return drainCursor(func() (int64, error) {
		return q.backend.RetryFinishedJobs(ctx, state, count, timestamp)
	})
}

// PromoteJobs moves delayed jobs to the wait list right away, looping until
// every eligible job has been moved.
func (q *Queue) PromoteJobs(ctx context.Context, count int64) (int64, error) {
	if count <= 0 {
		count = 1000
	}
	return drainCursor(func() (int64, error) {
		return q.backend.PromoteJobs(ctx, count)
	})
}

// drainCursor repeatedly invokes a batched backend operation until its cursor
// reports that no batch remains. The cursor is 1 when another batch of up to
// count jobs remains and 0 once complete, not a remaining-count, so a single
// call would leave jobs behind whenever more than count jobs are eligible; see
// the reference Queue.retryJobs, which loops the same way.
func drainCursor(step func() (int64, error)) (int64, error) {
	for {
		cursor, err := step()
		if err != nil {
			return 0, err
		}
		if cursor <= 0 {
			return cursor, nil
		}
	}
}

// Count returns the number of waiting, delayed, prioritized, and waiting-children jobs.
func (q *Queue) Count(ctx context.Context) (int64, error) {
	counts, err := q.JobCounts(ctx, StateWaiting, StateDelayed, StatePrioritized, StateWaitingChildren)
	if err != nil {
		return 0, err
	}
	var total int64
	for _, v := range counts {
		total += v
	}
	return total, nil
}

// JobCounts returns the number of jobs in each of the requested states. When no
// state is given every state in [AllStates] is returned.
func (q *Queue) JobCounts(ctx context.Context, states ...JobState) (JobCounts, error) {
	if len(states) == 0 {
		states = AllStates
	}
	values, err := q.backend.GetCounts(ctx, states)
	if err != nil {
		return nil, err
	}
	counts := make(JobCounts, len(states))
	for i, s := range states {
		if i < len(values) {
			counts[s] = values[i]
		}
	}
	return counts, nil
}

// JobIDs returns job ids for the requested states, ordered by their position in
// the underlying list or sorted set.
func (q *Queue) JobIDs(ctx context.Context, state JobState, start, end int64, asc bool) ([]string, error) {
	return q.backend.GetRanges(ctx, state, start, end, asc)
}

// Jobs returns the jobs in the requested state.
func (q *Queue) Jobs(ctx context.Context, state JobState, start, end int64, asc bool) ([]*Job, error) {
	records, err := q.backend.GetJobs(ctx, state, start, end, asc)
	if err != nil {
		return nil, err
	}
	jobs := make([]*Job, 0, len(records))
	for _, rec := range records {
		jobs = append(jobs, newJob(q.backend, rec))
	}
	return jobs, nil
}

// IsMaxed reports whether the queue reached its global concurrency limit.
func (q *Queue) IsMaxed(ctx context.Context) (bool, error) {
	return q.backend.IsMaxed(ctx)
}

// SetGlobalConcurrency limits how many jobs may be active across all workers.
// A value of 0 removes the limit.
func (q *Queue) SetGlobalConcurrency(ctx context.Context, max int64) error {
	if max <= 0 {
		return q.backend.RemoveQueueMetaFields(ctx, "concurrency")
	}
	return q.backend.SetQueueMeta(ctx, map[string]any{"concurrency": max})
}

// GlobalConcurrency returns the configured global concurrency limit, or 0 when
// no limit is set.
func (q *Queue) GlobalConcurrency(ctx context.Context) (int64, error) {
	val, ok, err := q.backend.GetQueueMetaField(ctx, "concurrency")
	if err != nil || !ok {
		return 0, err
	}
	return parseInt(val), nil
}

// SetGlobalRateLimit throttles every worker of this queue to at most max jobs
// per duration.
func (q *Queue) SetGlobalRateLimit(ctx context.Context, max int64, duration time.Duration) error {
	if max <= 0 {
		return configError("global rate limit max must be greater than 0")
	}
	if duration < time.Millisecond {
		return configError("global rate limit duration must be at least 1ms")
	}
	return q.backend.SetQueueMeta(ctx, map[string]any{
		"max":      max,
		"duration": duration.Milliseconds(),
	})
}

// RateLimitTTL returns the remaining rate limit window in milliseconds.
func (q *Queue) RateLimitTTL(ctx context.Context, maxJobs int64) (int64, error) {
	return q.backend.GetRateLimitTTL(ctx, maxJobs)
}

// Metrics returns the collected metrics for the completed or failed state.
func (q *Queue) Metrics(ctx context.Context, state JobState, start, end int64) (*Metrics, error) {
	if state != StateCompleted && state != StateFailed {
		return nil, configError("metrics state must be %q or %q", StateCompleted, StateFailed)
	}
	return q.backend.GetMetrics(ctx, state, start, end)
}

// Workers returns the client names of the workers currently connected to this queue.
func (q *Queue) Workers(ctx context.Context) ([]string, error) {
	lists, err := q.backend.GetClientList(ctx)
	if err != nil {
		return nil, err
	}
	unnamed := q.backend.ClientName("")
	namedPrefix := q.backend.ClientName(":w:")
	var names []string
	for _, raw := range lists {
		for _, line := range strings.Split(raw, "\n") {
			for _, field := range strings.Fields(line) {
				name, ok := strings.CutPrefix(field, "name=")
				if ok && (name == unnamed || strings.HasPrefix(name, namedPrefix)) {
					names = append(names, name)
				}
			}
		}
	}
	return names, nil
}
