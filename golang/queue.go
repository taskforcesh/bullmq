package bullmq

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

// Queue adds jobs to a BullMQ queue and inspects its contents.
//
// A Queue only depends on the [Backend] abstraction, so it works with any
// datastore for which a backend exists.
//
// A Queue is safe for concurrent use.
type Queue struct {
	backend           Backend
	defaultJobOptions *JobOptions
	repeatStrategy    RepeatStrategy
}

// priorityLimit is the largest accepted priority (2^21-1). The shared scripts
// compute scores as priority * 2^32 + counter, so larger values would exceed
// the exact integer range of Redis/Lua and lose the counter.
const priorityLimit int64 = 1<<21 - 1

// NewQueue creates a queue named name. It does not reach the datastore: the
// queue writes its metadata (see QueueOptions.SkipMetasUpdate) before its
// first command.
func NewQueue(name string, opts *QueueOptions) (*Queue, error) {
	if opts == nil {
		opts = &QueueOptions{}
	}
	meta, err := opts.metaValues()
	if err != nil {
		return nil, err
	}
	backend, err := resolveBackend(opts.Backend, name, BackendOptions{QueueMeta: meta})
	if err != nil {
		return nil, err
	}
	return &Queue{backend: backend, defaultJobOptions: opts.DefaultJobOptions, repeatStrategy: opts.RepeatStrategy}, nil
}

// Name returns the queue name.
func (q *Queue) Name() string { return q.backend.QueueName() }

// Backend returns the datastore backend used by the queue. Type-assert it to
// the concrete backend, for example *redisbackend.Backend, to reach
// datastore-specific features such as the underlying client.
func (q *Queue) Backend() Backend { return q.backend }

// Close releases the connections the queue owns.
func (q *Queue) Close() error { return q.backend.Close() }

// JobSpec describes a job to add through Add or AddBulk.
type JobSpec struct {
	// Name is the job name handed to the processor.
	Name string
	// Data is the payload; it is marshalled to JSON. nil is stored as {}, as
	// Node stores a job added without data.
	Data any
	// Opts overrides the queue default job options.
	Opts *JobOptions
}

// Add inserts a single job into the queue. data is marshalled to JSON, and
// nil is stored as {}, as Node stores a job added without data. When the
// job is deduplicated (see [DeduplicationOptions]), nothing is added and the
// returned Job has the ID of the job that holds the deduplication id.
func (q *Queue) Add(ctx context.Context, name string, data any, opts *JobOptions) (*Job, error) {
	nj, err := q.prepareJob(JobSpec{Name: name, Data: data, Opts: opts})
	if err != nil {
		return nil, err
	}
	id, err := q.backend.AddJob(ctx, nj)
	if err != nil {
		return nil, err
	}
	return q.newAddedJob(id, nj)
}

// AddBulk inserts every job in one backend operation. On PostgreSQL that is
// a database transaction: a failed batch adds no job. On Redis it is a
// single transaction, but Redis does not roll back the scripts that ran
// when another returns an application-level error, such as a missing
// parent, so a failed batch may leave the other jobs added.
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
		if jobs[i], err = q.newAddedJob(ids[i], nj); err != nil {
			return nil, err
		}
	}
	return jobs, nil
}

// newAddedJob builds the Job returned to the caller of Add or AddBulk.
func (q *Queue) newAddedJob(id string, nj NewJob) (*Job, error) {
	job := &Job{
		ID:        id,
		Name:      nj.Name,
		Data:      nj.Data,
		Opts:      nj.Opts,
		Timestamp: nj.Opts.Timestamp,
		Delay:     nj.Opts.delayMs(),
		Priority:  nj.Opts.priorityVal(),
		QueueName: q.Name(),
		backend:   q.backend,

		DeduplicationID: nj.Opts.deduplicationID(),
	}
	if nj.Opts.Parent != nil {
		parent, parentKey, err := q.backend.ResolveParent(nj.Opts.Parent)
		if err != nil {
			return nil, err
		}
		job.Parent = parent
		job.ParentKey = parentKey
	}
	return job, nil
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
	if opts.Repeat != nil {
		return NewJob{}, configError("repeat is not a valid job option; use Queue.UpsertJobScheduler to repeat jobs")
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
	// Node stores {} for jobs added without data, and processors written for
	// it expect an object, so nil is stored as {} too.
	if string(payload) == "null" {
		payload = []byte("{}")
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

// ObliterateOptions tunes [Queue.Obliterate], as Node's obliterate options
// do.
type ObliterateOptions struct {
	// Force obliterates the queue even while some of its jobs are active.
	Force bool
	// Count is how many jobs are removed per datastore call, so that a
	// large queue doesn't block the datastore; it is not a cap on the
	// total. 0 means 1000.
	Count int64
}

// Obliterate deletes the queue and every job in it, with its metadata,
// whatever their state. opts may be nil.
//
// The queue is paused first, matching the behaviour of the other ports.
// Unless opts.Force is set, the call fails if there are still active jobs.
func (q *Queue) Obliterate(ctx context.Context, opts *ObliterateOptions) error {
	var o ObliterateOptions
	if opts != nil {
		o = *opts
	}
	if o.Count <= 0 {
		o.Count = 1000
	}
	if err := q.Pause(ctx); err != nil {
		return err
	}
	for {
		remaining, err := q.backend.Obliterate(ctx, o.Force, o.Count)
		if err != nil {
			return err
		}
		if remaining <= 0 {
			return nil
		}
	}
}

// cleanableStates are the states accepted by Clean. "wait" is Node's name
// of the waiting state.
var cleanableStates = map[JobState]bool{
	JobState("wait"): true,
	StateWaiting:     true,
	StateActive:      true,
	StatePrioritized: true,
	StateDelayed:     true,
	StateCompleted:   true,
	StateFailed:      true,
	StatePaused:      true,
}

// cleanMaxBatch bounds how many jobs a single CleanJobsByState call may
// remove. The operation runs atomically, so an unbounded call on a large state
// could block every client; this matches the reference implementation.
const cleanMaxBatch int64 = 10000

// Clean removes finished (or waiting/delayed) jobs older than grace.
//
// state must be one of StateWaiting, StateActive, StatePaused,
// StatePrioritized, StateDelayed, StateCompleted or StateFailed ("wait" is
// accepted for StateWaiting, as in Node). A limit of 0 means unlimited.
// Removal runs in batches of at most 10,000 jobs, repeating until limit jobs
// were removed or a batch comes back short, so a large state never blocks
// the datastore in a single call. It returns the removed job ids.
func (q *Queue) Clean(ctx context.Context, grace time.Duration, limit int64, state JobState) ([]string, error) {
	if !cleanableStates[state] {
		return nil, configError("clean state must be one of waiting, active, paused, prioritized, delayed, completed or failed, got %q", state)
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

// RetryJobsOptions tunes [Queue.RetryJobs], as the options of Node's
// retryJobs do.
type RetryJobsOptions struct {
	// State is the state of the jobs to retry: StateFailed (the default) or
	// StateCompleted.
	State JobState
	// Count is how many jobs are moved per batch, one datastore call each,
	// not a cap on the total; 0 means 1000.
	Count int64
	// Before only retries the jobs that finished at or before it; the zero
	// time means now.
	Before time.Time
}

// RetryJobs moves every failed (or completed) job back to the wait list, in
// batches, as Node's retryJobs does. opts may be nil. Their attempt counters
// are kept on Redis but reset on PostgreSQL, as the shared commands do.
func (q *Queue) RetryJobs(ctx context.Context, opts *RetryJobsOptions) error {
	var o RetryJobsOptions
	if opts != nil {
		o = *opts
	}
	if o.State == "" {
		o.State = StateFailed
	}
	if o.State != StateCompleted && o.State != StateFailed {
		return configError("retry state must be %q or %q", StateCompleted, StateFailed)
	}
	if o.Count <= 0 {
		o.Count = 1000
	}
	timestamp := nowMillis()
	if !o.Before.IsZero() {
		timestamp = o.Before.UnixMilli()
	}
	return drainCursor(func() (int64, error) {
		return q.backend.RetryFinishedJobs(ctx, o.State, o.Count, timestamp)
	})
}

// PromoteJobs moves every delayed job to the wait list right away, in
// batches of count jobs (one datastore call each; 0 means 1000), as Node's
// promoteJobs does.
func (q *Queue) PromoteJobs(ctx context.Context, count int64) error {
	if count <= 0 {
		count = 1000
	}
	return drainCursor(func() (int64, error) {
		return q.backend.PromoteJobs(ctx, count)
	})
}

// drainCursor repeatedly invokes a batched backend operation until its cursor
// reports that no batch remains. The cursor is not a count of jobs: on Redis
// it is 1 when another batch of up to count jobs may remain and 0 once
// complete, so a single call would leave jobs behind whenever more than count
// jobs are eligible; see the reference Queue.retryJobs, which loops the same
// way.
func drainCursor(step func() (int64, error)) error {
	for {
		cursor, err := step()
		if err != nil {
			return err
		}
		if cursor <= 0 {
			return nil
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

// JobIDs returns the ids of the jobs in the given states, as Node's
// getRanges does: for each state, in order, the jobs at positions start to
// end (inclusive; a negative end counts from the last one) of that state,
// so the range applies to every state on its own. A job listed twice is
// returned once. With no state, every state in [AllStates] is listed.
//
// asc selects the order within each state. Node's shortcuts use asc=true for
// waiting, active, delayed, prioritized and waiting-children jobs (oldest or
// first due first: getWaiting, getActive, getDelayed, getPrioritized,
// getWaitingChildren) and asc=false for completed and failed jobs (most
// recent first: getCompleted, getFailed), and getJobs defaults to false.
func (q *Queue) JobIDs(ctx context.Context, start, end int64, asc bool, states ...JobState) ([]string, error) {
	return q.backend.GetRanges(ctx, jobStates(states), start, end, asc)
}

// Jobs returns the jobs in the given states, selected and ordered as by
// JobIDs, as Node's getJobs does. For example, the 10 most recent failures:
//
//	jobs, err := queue.Jobs(ctx, 0, 9, false, bullmq.StateFailed)
func (q *Queue) Jobs(ctx context.Context, start, end int64, asc bool, states ...JobState) ([]*Job, error) {
	records, err := q.backend.GetJobs(ctx, jobStates(states), start, end, asc)
	if err != nil {
		return nil, err
	}
	jobs := make([]*Job, 0, len(records))
	for _, rec := range records {
		jobs = append(jobs, newJob(q.backend, rec))
	}
	return jobs, nil
}

// jobStates returns states without duplicates, or AllStates when empty.
func jobStates(states []JobState) []JobState {
	if len(states) == 0 {
		return AllStates
	}
	unique := make([]JobState, 0, len(states))
	seen := make(map[JobState]bool, len(states))
	for _, s := range states {
		if !seen[s] {
			seen[s] = true
			unique = append(unique, s)
		}
	}
	return unique
}

// IsMaxed reports whether the queue reached its global concurrency limit.
func (q *Queue) IsMaxed(ctx context.Context) (bool, error) {
	return q.backend.IsMaxed(ctx)
}

// SetGlobalConcurrency limits how many jobs may be active across all workers.
// A value of 0 (or less) removes the limit, as RemoveGlobalConcurrency does.
// Unlike Go, Node's setGlobalConcurrency(0) stores 0, which stops every
// worker: the queue is then always maxed.
func (q *Queue) SetGlobalConcurrency(ctx context.Context, max int64) error {
	if max <= 0 {
		return q.RemoveGlobalConcurrency(ctx)
	}
	return q.backend.SetQueueMeta(ctx, map[string]any{"concurrency": max})
}

// RemoveGlobalConcurrency removes the global concurrency limit.
func (q *Queue) RemoveGlobalConcurrency(ctx context.Context) error {
	return q.backend.RemoveQueueMetaFields(ctx, "concurrency")
}

// GlobalConcurrency returns the global concurrency limit, or nil when none
// is set, as Node's getGlobalConcurrency returns null. It may be 0 when
// another port stored it (see SetGlobalConcurrency): no job is then
// fetched, and IsMaxed reports true.
func (q *Queue) GlobalConcurrency(ctx context.Context) (*int64, error) {
	val, ok, err := q.backend.GetQueueMetaField(ctx, "concurrency")
	if err != nil || !ok || val == "" {
		return nil, err
	}
	n := parseInt(val)
	return &n, nil
}

// SetGlobalRateLimit throttles every worker of this queue to at most max jobs
// per duration. For a worker that also has a Limiter, this max and the
// Limiter's Duration apply, as in Node.js. A max of 0 removes the limit, as
// RemoveGlobalRateLimit does.
func (q *Queue) SetGlobalRateLimit(ctx context.Context, max int64, duration time.Duration) error {
	if max <= 0 {
		return q.RemoveGlobalRateLimit(ctx)
	}
	if duration < time.Millisecond {
		return configError("global rate limit duration must be at least 1ms")
	}
	return q.backend.SetQueueMeta(ctx, map[string]any{
		"max":      max,
		"duration": duration.Milliseconds(),
	})
}

// RemoveGlobalRateLimit removes the global rate limit: workers are then only
// limited by their own Limiter.
func (q *Queue) RemoveGlobalRateLimit(ctx context.Context) error {
	return q.backend.RemoveQueueMetaFields(ctx, "max", "duration")
}

// GlobalRateLimit returns the global rate limit, or nil when none is set.
func (q *Queue) GlobalRateLimit(ctx context.Context) (*RateLimiter, error) {
	max, ok, err := q.backend.GetQueueMetaField(ctx, "max")
	if err != nil || !ok || max == "" {
		return nil, err
	}
	duration, ok, err := q.backend.GetQueueMetaField(ctx, "duration")
	if err != nil || !ok || duration == "" {
		return nil, err
	}
	return &RateLimiter{Max: parseInt(max), Duration: time.Duration(parseInt(duration)) * time.Millisecond}, nil
}

// RateLimitTTL returns how long, in milliseconds, the queue stays rate
// limited, as Node's getRateLimitTtl does.
//
// maxJobs is the number of jobs per window that makes the queue rate
// limited: RateLimitTTL returns the time left in the current window once at
// least maxJobs jobs were counted in it, and 0 otherwise. A maxJobs of 0, like
// Node's omitted argument, uses the Max of the global rate limit (see
// SetGlobalRateLimit). Without a global rate limit either, it returns the
// time left in the current window whatever its count, or the codes of Redis
// PTTL: -2 when no window is open, and -1 when the window never expires.
func (q *Queue) RateLimitTTL(ctx context.Context, maxJobs int64) (int64, error) {
	return q.backend.GetRateLimitTTL(ctx, maxJobs)
}

// DeduplicationJobID returns the id of the job that holds the deduplication
// id dedupID (see [DeduplicationOptions]), or "" when no job holds it: it
// was never used, was removed, or its TTL expired. While a job holds it,
// adding a job with the same deduplication id returns that job's id.
func (q *Queue) DeduplicationJobID(ctx context.Context, dedupID string) (string, error) {
	return q.backend.GetDeduplicationJobID(ctx, dedupID)
}

// RemoveDeduplicationKey releases the deduplication id dedupID, whichever
// job holds it, so the next job added with it is not deduplicated. It
// reports whether there was one to release. Job.RemoveDeduplicationKey
// releases it only if a given job still holds it.
func (q *Queue) RemoveDeduplicationKey(ctx context.Context, dedupID string) (bool, error) {
	return q.backend.DeleteDeduplicationKey(ctx, dedupID)
}

// Metrics returns the collected metrics for the completed or failed state.
func (q *Queue) Metrics(ctx context.Context, state JobState, start, end int64) (*Metrics, error) {
	if state != StateCompleted && state != StateFailed {
		return nil, configError("metrics state must be %q or %q", StateCompleted, StateFailed)
	}
	return q.backend.GetMetrics(ctx, state, start, end)
}

// WorkerInfo describes a worker connected to a queue, as listed by
// Queue.Workers.
type WorkerInfo struct {
	// Name is the worker's name (WorkerOptions.Name), or "" for a worker
	// without one.
	Name string
	// Fields holds what the datastore reports about the worker's
	// connection: every field of its CLIENT LIST entry on Redis (id, addr,
	// age, idle, ...), only name on PostgreSQL. Fields["name"] is the raw
	// connection name, which encodes the queue: `{prefix}:{base64(queue)}`
	// followed by `:w:{name}` for a named worker on Redis, `{queue}` and
	// `:w:{name}` on PostgreSQL, where it is reported as the worker set it,
	// with PostgreSQL's `\xhh` escaping of non-ASCII bytes undone.
	Fields map[string]string
}

// Workers lists the workers connected to this queue, as Node's getWorkers
// does. Workers are found by the name of their dedicated connection, in
// CLIENT LIST on Redis and in pg_stat_activity on PostgreSQL. PostgreSQL
// stores each non-ASCII byte of a connection name as a 4-byte `\xhh` escape
// (a `?` before version 16, which loses the worker name's non-ASCII
// characters) and truncates the result to 63 bytes, so there the workers of
// a queue with a long name may be missing, and long worker names are
// truncated.
func (q *Queue) Workers(ctx context.Context) ([]WorkerInfo, error) {
	lists, err := q.backend.GetClientList(ctx)
	if err != nil {
		return nil, err
	}
	unnamed := q.backend.ClientName("")
	namedPrefix := q.backend.ClientName(":w:")
	var workers []WorkerInfo
	// A clustered datastore reports one list per node, each with the
	// connections to that node; the node with the most workers lists them
	// all, as in Node.js.
	for _, list := range lists {
		var found []WorkerInfo
		for _, fields := range parseClientList(list) {
			raw := fields["name"]
			switch {
			case raw == unnamed:
				found = append(found, WorkerInfo{Fields: fields})
			case strings.HasPrefix(raw, namedPrefix):
				found = append(found, WorkerInfo{Name: raw[len(namedPrefix):], Fields: fields})
			}
		}
		if len(found) > len(workers) {
			workers = found
		}
	}
	if workers == nil {
		workers = []WorkerInfo{}
	}
	return workers, nil
}

// parseClientList parses connection lists in the `CLIENT LIST` format: one
// connection per line, as space-separated key=value fields. A word without
// `=` continues the previous value, so a PostgreSQL application_name that
// contains spaces is read whole.
func parseClientList(list string) []map[string]string {
	var clients []map[string]string
	for _, line := range strings.Split(list, "\n") {
		line = strings.TrimSuffix(line, "\r")
		if line == "" {
			continue
		}
		fields := make(map[string]string)
		last := ""
		for _, word := range strings.Split(line, " ") {
			key, value, ok := strings.Cut(word, "=")
			if !ok && last != "" {
				fields[last] += " " + word
				continue
			}
			fields[key] = value
			last = key
		}
		clients = append(clients, fields)
	}
	return clients
}
