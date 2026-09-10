package bullmq

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// Queue adds jobs to a Redis backed BullMQ queue and inspects its contents.
//
// A Queue is safe for concurrent use.
type Queue struct {
	c                 *client
	defaultJobOptions *JobOptions
}

// NewQueue creates a queue named name.
func NewQueue(name string, opts *QueueOptions) (*Queue, error) {
	if opts == nil {
		opts = &QueueOptions{}
	}
	c, err := newClient(name, opts.Prefix, opts.Redis)
	if err != nil {
		return nil, err
	}
	return &Queue{c: c, defaultJobOptions: opts.DefaultJobOptions}, nil
}

// Name returns the queue name.
func (q *Queue) Name() string { return q.c.keys.Name() }

// Keys exposes the key generator used by the queue.
func (q *Queue) Keys() *Keys { return q.c.keys }

// Client returns the underlying Redis client.
func (q *Queue) Client() redis.UniversalClient { return q.c.rdb }

// Close releases the Redis connection when the queue owns it.
func (q *Queue) Close() error { return q.c.close() }

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
	return q.addJob(ctx, JobSpec{Name: name, Data: data, Opts: opts})
}

// AddBulk inserts several jobs, one round trip per job.
func (q *Queue) AddBulk(ctx context.Context, specs []JobSpec) ([]*Job, error) {
	jobs := make([]*Job, 0, len(specs))
	for _, spec := range specs {
		job, err := q.addJob(ctx, spec)
		if err != nil {
			return jobs, err
		}
		jobs = append(jobs, job)
	}
	return jobs, nil
}

func (q *Queue) addJob(ctx context.Context, spec JobSpec) (*Job, error) {
	opts := mergeJobOptions(spec.Opts, q.defaultJobOptions)

	payload, err := json.Marshal(spec.Data)
	if err != nil {
		return nil, err
	}
	if opts.SizeLimit > 0 && int64(len(payload)) > opts.SizeLimit {
		return nil, configError("job data exceeds sizeLimit of %d bytes (was %d)",
			opts.SizeLimit, len(payload))
	}

	timestamp := opts.Timestamp
	if timestamp == 0 {
		timestamp = nowMillis()
	}

	var scriptName string
	var keys []string
	switch {
	case opts.Delay > 0:
		scriptName = "addDelayedJob"
		keys = []string{
			q.c.keys.Marker(), q.c.keys.Meta(), q.c.keys.ID(),
			q.c.keys.Delayed(), q.c.keys.Completed(), q.c.keys.Events(),
		}
	case opts.Priority > 0:
		scriptName = "addPrioritizedJob"
		keys = []string{
			q.c.keys.Marker(), q.c.keys.Meta(), q.c.keys.ID(),
			q.c.keys.Prioritized(), q.c.keys.Delayed(), q.c.keys.Completed(),
			q.c.keys.Active(), q.c.keys.Events(), q.c.keys.PC(),
		}
	default:
		scriptName = "addStandardJob"
		keys = []string{
			q.c.keys.Wait(), q.c.keys.Paused(), q.c.keys.Meta(), q.c.keys.ID(),
			q.c.keys.Completed(), q.c.keys.Delayed(), q.c.keys.Active(),
			q.c.keys.Events(), q.c.keys.Marker(),
		}
	}

	argv1, err := q.packAddArgs(opts, spec.Name, timestamp)
	if err != nil {
		return nil, err
	}

	res, err := q.c.runScript(ctx, scriptName, keys,
		argv1, string(payload), packJobOptions(opts))
	if err != nil {
		return nil, err
	}
	if code, ok := asInt64(res); ok && code < 0 {
		return nil, scriptError(scriptName, code)
	}
	jobID, ok := asString(res)
	if !ok {
		return nil, configError("unexpected reply from %s", scriptName)
	}

	return &Job{
		ID:        jobID,
		Name:      spec.Name,
		Data:      payload,
		Opts:      opts,
		Timestamp: timestamp,
		Delay:     opts.Delay,
		Priority:  opts.Priority,
		QueueName: q.Name(),
		c:         q.c,
	}, nil
}

// packAddArgs builds ARGV[1] of the add* commands: a msgpack array of
// [keyPrefix, customId, name, timestamp, parentKey, parentDepsKey, parent,
// repeatJobKey, deduplicationKey].
func (q *Queue) packAddArgs(opts *JobOptions, name string, timestamp int64) ([]byte, error) {
	w := newMsgpackWriter(160)
	w.ArrayLen(9)
	w.Str(q.c.keys.KeyPrefix())
	w.Str(opts.JobID)
	w.Str(name)
	w.Uint(uint64(timestamp))

	if opts.Parent != nil {
		parentQueueKey, err := resolveParentQueueKey(q.c.keys.Prefix(), opts.Parent.Queue)
		if err != nil {
			return nil, err
		}
		parentKey := parentQueueKey + ":" + opts.Parent.ID
		w.Str(parentKey)
		w.Str(parentKey + ":dependencies")

		flags := map[string]bool{
			"fpof": opts.FailParentOnFailure,
			"idof": opts.IgnoreDependencyOnFailure,
			"rdof": opts.RemoveDependencyOnFailure,
			"cpof": opts.ContinueParentOnFailure,
		}
		n := 2
		for _, v := range flags {
			if v {
				n++
			}
		}
		w.MapLen(n)
		w.Str("id")
		w.Str(opts.Parent.ID)
		w.Str("queueKey")
		w.Str(parentQueueKey)
		// Iterated in a fixed order so the encoding is deterministic.
		for _, k := range []string{"fpof", "idof", "rdof", "cpof"} {
			if flags[k] {
				w.Str(k)
				w.Bool(true)
			}
		}
	} else {
		w.Nil()
		w.Nil()
		w.Nil()
	}

	// repeat job key: job schedulers are not supported by this port yet.
	w.Nil()

	if opts.Deduplication != nil && opts.Deduplication.ID != "" {
		w.Str(q.c.keys.Base() + ":de:" + opts.Deduplication.ID)
	} else {
		w.Nil()
	}
	return w.Bytes(), nil
}

// packJobOptions builds ARGV[3] of the add* commands.
func packJobOptions(opts *JobOptions) []byte {
	type entry struct {
		key   string
		write func(*msgpackWriter)
	}
	var entries []entry

	if opts.Delay > 0 {
		entries = append(entries, entry{"delay", func(w *msgpackWriter) { w.Uint(uint64(opts.Delay)) }})
	}
	if opts.Priority > 0 {
		entries = append(entries, entry{"priority", func(w *msgpackWriter) { w.Uint(uint64(opts.Priority)) }})
	}
	if opts.Attempts > 0 {
		entries = append(entries, entry{"attempts", func(w *msgpackWriter) { w.Uint(uint64(opts.Attempts)) }})
	}
	if opts.LIFO {
		entries = append(entries, entry{"lifo", func(w *msgpackWriter) { w.Bool(true) }})
	}
	if opts.KeepLogs > 0 {
		entries = append(entries, entry{"kl", func(w *msgpackWriter) { w.Uint(uint64(opts.KeepLogs)) }})
	}
	if opts.SizeLimit > 0 {
		entries = append(entries, entry{"sizeLimit", func(w *msgpackWriter) { w.Uint(uint64(opts.SizeLimit)) }})
	}
	if opts.RemoveOnComplete != nil {
		roc := opts.RemoveOnComplete
		entries = append(entries, entry{"removeOnComplete", func(w *msgpackWriter) { roc.writeMsgpack(w) }})
	}
	if opts.RemoveOnFail != nil {
		rof := opts.RemoveOnFail
		entries = append(entries, entry{"removeOnFail", func(w *msgpackWriter) { rof.writeMsgpack(w) }})
	}
	if opts.Backoff != nil {
		b := opts.Backoff
		entries = append(entries, entry{"backoff", func(w *msgpackWriter) { b.writeMsgpack(w) }})
	}
	for key, enabled := range map[string]bool{
		"fpof": opts.FailParentOnFailure,
		"cpof": opts.ContinueParentOnFailure,
		"idof": opts.IgnoreDependencyOnFailure,
		"rdof": opts.RemoveDependencyOnFailure,
	} {
		if enabled {
			entries = append(entries, entry{key, func(w *msgpackWriter) { w.Bool(true) }})
		}
	}
	if d := opts.Deduplication; d != nil && d.ID != "" {
		entries = append(entries, entry{"de", func(w *msgpackWriter) {
			n := 1
			if d.TTL > 0 {
				n++
			}
			if d.Extend {
				n++
			}
			if d.Replace {
				n++
			}
			w.MapLen(n)
			w.Str("id")
			w.Str(d.ID)
			if d.TTL > 0 {
				w.Str("ttl")
				w.Uint(uint64(d.TTL))
			}
			if d.Extend {
				w.Str("extend")
				w.Bool(true)
			}
			if d.Replace {
				w.Str("replace")
				w.Bool(true)
			}
		}})
	}

	w := newMsgpackWriter(96)
	w.MapLen(len(entries))
	for _, e := range entries {
		w.Str(e.key)
		e.write(w)
	}
	return w.Bytes()
}

// Job fetches a job by id. It returns nil when the job does not exist.
func (q *Queue) Job(ctx context.Context, jobID string) (*Job, error) {
	fields, err := q.c.rdb.HGetAll(ctx, q.c.keys.Job(jobID)).Result()
	if err != nil {
		return nil, err
	}
	if len(fields) == 0 {
		return nil, nil
	}
	return jobFromHash(q.c, jobID, fields), nil
}

// JobState returns the state of a job.
func (q *Queue) JobState(ctx context.Context, jobID string) (JobState, error) {
	return jobState(ctx, q.c, jobID)
}

// Pause stops workers from picking up new jobs. Jobs already active keep running.
func (q *Queue) Pause(ctx context.Context) error {
	return q.c.runScriptStatus(ctx, "pause", []string{
		q.c.keys.Wait(), q.c.keys.Paused(), q.c.keys.Meta(), q.c.keys.Prioritized(),
		q.c.keys.Events(), q.c.keys.Delayed(), q.c.keys.Marker(),
	}, "paused", "1")
}

// Resume lets workers pick up jobs again.
func (q *Queue) Resume(ctx context.Context) error {
	emitEvent := "1"
	for {
		res, err := q.c.runScript(ctx, "pause", []string{
			q.c.keys.Paused(), q.c.keys.Wait(), q.c.keys.Meta(), q.c.keys.Prioritized(),
			q.c.keys.Events(), q.c.keys.Delayed(), q.c.keys.Marker(),
		}, "resumed", emitEvent)
		if err != nil {
			return err
		}
		remaining, _ := asInt64(res)
		if remaining <= 0 {
			return nil
		}
		emitEvent = "0"
	}
}

// IsPaused reports whether the queue is paused.
func (q *Queue) IsPaused(ctx context.Context) (bool, error) {
	val, err := q.c.rdb.HGet(ctx, q.c.keys.Meta(), "paused").Result()
	if err == redis.Nil {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return val != "" && val != "0", nil
}

// Drain removes all waiting and prioritized jobs. Active, completed and failed
// jobs are left untouched. When delayed is true, delayed jobs are removed too.
func (q *Queue) Drain(ctx context.Context, delayed bool) error {
	_, err := q.c.runScript(ctx, "drain", []string{
		q.c.keys.Wait(), q.c.keys.Paused(), q.c.keys.Delayed(),
		q.c.keys.Prioritized(), q.c.keys.Repeat(),
	}, q.c.keys.KeyPrefix(), boolToStr(delayed))
	return err
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
	forceArg := ""
	if force {
		forceArg = "force"
	}
	for {
		res, err := q.c.runScript(ctx, "obliterate",
			[]string{q.c.keys.Meta(), q.c.keys.KeyPrefix()}, count, forceArg)
		if err != nil {
			return err
		}
		remaining, _ := asInt64(res)
		switch {
		case remaining == -1:
			return configError("cannot obliterate a queue that is not paused")
		case remaining == -2:
			return configError("cannot obliterate a queue with active jobs")
		case remaining <= 0:
			return nil
		}
	}
}

// Clean removes finished (or waiting/delayed) jobs older than grace.
//
// state must be one of wait, active, paused, prioritized, delayed, completed or
// failed. A limit of 0 means unlimited. It returns the removed job ids.
func (q *Queue) Clean(ctx context.Context, grace time.Duration, limit int64, state JobState) ([]string, error) {
	name := string(state)
	if state == StateWaiting {
		name = "wait"
	}
	res, err := q.c.runScript(ctx, "cleanJobsInSet", []string{
		q.c.keys.Get(name), q.c.keys.Events(), q.c.keys.Repeat(),
	}, q.c.keys.KeyPrefix(), nowMillis()-grace.Milliseconds(), limit, name)
	if err != nil {
		return nil, err
	}
	arr, _ := res.([]any)
	ids := make([]string, 0, len(arr))
	for _, v := range arr {
		if s, ok := asString(v); ok {
			ids = append(ids, s)
		}
	}
	return ids, nil
}

// RetryJobs moves completed or failed jobs back to the wait list and returns
// the number of jobs that still remain to be moved.
func (q *Queue) RetryJobs(ctx context.Context, state JobState, count int64) (int64, error) {
	if state != StateCompleted && state != StateFailed {
		return 0, configError("retry state must be %q or %q", StateCompleted, StateFailed)
	}
	return q.moveJobsToWait(ctx, string(state), count, nowMillis())
}

// PromoteJobs moves delayed jobs to the wait list right away and returns the
// number of jobs that still remain to be moved.
func (q *Queue) PromoteJobs(ctx context.Context, count int64) (int64, error) {
	return q.moveJobsToWait(ctx, "delayed", count, 1<<53)
}

func (q *Queue) moveJobsToWait(ctx context.Context, state string, count, timestamp int64) (int64, error) {
	if count <= 0 {
		count = 1000
	}
	res, err := q.c.runScript(ctx, "moveJobsToWait", []string{
		q.c.keys.KeyPrefix(), q.c.keys.Events(), q.c.keys.Get(state),
		q.c.keys.Wait(), q.c.keys.Paused(), q.c.keys.Meta(),
		q.c.keys.Active(), q.c.keys.Marker(),
	}, count, timestamp, state)
	if err != nil {
		return 0, err
	}
	remaining, _ := asInt64(res)
	return remaining, nil
}

// Count returns the number of waiting, delayed and prioritized jobs.
func (q *Queue) Count(ctx context.Context) (int64, error) {
	counts, err := q.JobCounts(ctx, StateWaiting, StateDelayed, StatePrioritized)
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
	args := make([]any, 0, len(states))
	for _, s := range states {
		args = append(args, luaStateName(s))
	}
	res, err := q.c.runScript(ctx, "getCounts", []string{q.c.keys.KeyPrefix()}, args...)
	if err != nil {
		return nil, err
	}
	arr, _ := res.([]any)
	counts := make(JobCounts, len(states))
	for i, s := range states {
		if i < len(arr) {
			n, _ := asInt64(arr[i])
			counts[s] = n
		}
	}
	return counts, nil
}

// JobIDs returns job ids for the requested states, ordered by their position in
// the underlying list or sorted set.
func (q *Queue) JobIDs(ctx context.Context, state JobState, start, end int64, asc bool) ([]string, error) {
	res, err := q.c.runScript(ctx, "getRanges", []string{q.c.keys.KeyPrefix()},
		start, end, boolToStr(asc), luaStateName(state))
	if err != nil {
		return nil, err
	}
	groups, _ := res.([]any)
	var ids []string
	for _, group := range groups {
		entries, ok := group.([]any)
		if !ok {
			continue
		}
		for _, entry := range entries {
			if s, ok := asString(entry); ok {
				ids = append(ids, s)
			}
		}
	}
	return ids, nil
}

// Jobs returns the jobs in the requested state.
func (q *Queue) Jobs(ctx context.Context, state JobState, start, end int64, asc bool) ([]*Job, error) {
	ids, err := q.JobIDs(ctx, state, start, end, asc)
	if err != nil {
		return nil, err
	}
	jobs := make([]*Job, 0, len(ids))
	for _, id := range ids {
		job, err := q.Job(ctx, id)
		if err != nil {
			return nil, err
		}
		if job != nil {
			jobs = append(jobs, job)
		}
	}
	return jobs, nil
}

// IsMaxed reports whether the queue reached its global concurrency limit.
func (q *Queue) IsMaxed(ctx context.Context) (bool, error) {
	res, err := q.c.runScript(ctx, "isMaxed",
		[]string{q.c.keys.Meta(), q.c.keys.Active()})
	if err != nil {
		return false, err
	}
	n, _ := asInt64(res)
	return n == 1, nil
}

// SetGlobalConcurrency limits how many jobs may be active across all workers.
// A value of 0 removes the limit.
func (q *Queue) SetGlobalConcurrency(ctx context.Context, max int64) error {
	if max <= 0 {
		return q.c.rdb.HDel(ctx, q.c.keys.Meta(), "concurrency").Err()
	}
	return q.c.rdb.HSet(ctx, q.c.keys.Meta(), "concurrency", max).Err()
}

// GlobalConcurrency returns the configured global concurrency limit, or 0 when
// no limit is set.
func (q *Queue) GlobalConcurrency(ctx context.Context) (int64, error) {
	val, err := q.c.rdb.HGet(ctx, q.c.keys.Meta(), "concurrency").Result()
	if err == redis.Nil {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	return parseInt(val), nil
}

// SetGlobalRateLimit throttles every worker of this queue to at most max jobs
// per duration.
func (q *Queue) SetGlobalRateLimit(ctx context.Context, max int64, duration time.Duration) error {
	return q.c.rdb.HSet(ctx, q.c.keys.Meta(),
		"rateLimiterMax", max,
		"rateLimiterDuration", duration.Milliseconds()).Err()
}

// RateLimitTTL returns the remaining rate limit window in milliseconds.
func (q *Queue) RateLimitTTL(ctx context.Context, maxJobs int64) (int64, error) {
	res, err := q.c.runScript(ctx, "getRateLimitTtl",
		[]string{q.c.keys.Limiter(), q.c.keys.Meta()}, strconv.FormatInt(maxJobs, 10))
	if err != nil {
		return 0, err
	}
	ttl, _ := asInt64(res)
	return ttl, nil
}

// Metrics returns the collected metrics for the completed or failed state.
func (q *Queue) Metrics(ctx context.Context, state JobState, start, end int64) (*Metrics, error) {
	if state != StateCompleted && state != StateFailed {
		return nil, configError("metrics state must be %q or %q", StateCompleted, StateFailed)
	}
	key := q.c.keys.Metrics(string(state))
	res, err := q.c.runScript(ctx, "getMetrics", []string{key, key + ":data"}, start, end)
	if err != nil {
		return nil, err
	}
	arr, _ := res.([]any)
	m := &Metrics{}
	if len(arr) > 0 {
		meta := flatToMap(arr[0])
		m.Count = parseInt(meta["count"])
		m.PrevCount = parseInt(meta["prevCount"])
		m.PrevTS = parseInt(meta["prevTS"])
	}
	if len(arr) > 1 {
		points, _ := arr[1].([]any)
		m.Data = make([]int64, 0, len(points))
		for _, p := range points {
			n, _ := asInt64(p)
			m.Data = append(m.Data, n)
		}
	}
	return m, nil
}

// Workers returns the client names of the workers currently connected to this queue.
func (q *Queue) Workers(ctx context.Context) ([]string, error) {
	raw, err := q.c.rdb.ClientList(ctx).Result()
	if err != nil {
		return nil, err
	}
	prefix := q.c.keys.ClientName("")
	var names []string
	for _, line := range strings.Split(raw, "\n") {
		for _, field := range strings.Fields(line) {
			name, ok := strings.CutPrefix(field, "name=")
			if ok && strings.HasPrefix(name, prefix) {
				names = append(names, name)
			}
		}
	}
	return names, nil
}

// luaStateName maps a JobState to the key suffix used by the Lua commands.
func luaStateName(state JobState) string {
	if state == StateWaiting {
		return "wait"
	}
	return string(state)
}
