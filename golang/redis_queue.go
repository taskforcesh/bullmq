package bullmq

import (
	"context"
	"math"
	"strconv"

	"github.com/redis/go-redis/v9"
)

// getJobsMaxBackfillIterations bounds how many forward-backfill iterations the
// `getJobs` Lua command performs for a bounded range, matching the other
// BullMQ ports.
const getJobsMaxBackfillIterations = 5

// Pause pauses (true) or resumes (false) the queue.
func (b *RedisBackend) Pause(ctx context.Context, paused bool) error {
	k := b.keys
	if paused {
		return b.runScriptStatus(ctx, "pause", []string{
			k.Wait(), k.Paused(), k.Meta(), k.Prioritized(),
			k.Events(), k.Delayed(), k.Marker(),
		}, "paused", "1")
	}

	// Resuming moves the paused jobs in batches; the event is only emitted by
	// the first call.
	emitEvent := "1"
	for {
		res, err := b.runScript(ctx, "pause", []string{
			k.Paused(), k.Wait(), k.Meta(), k.Prioritized(),
			k.Events(), k.Delayed(), k.Marker(),
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

// Drain removes all waiting and prioritized jobs, and delayed jobs too when
// delayed is true.
func (b *RedisBackend) Drain(ctx context.Context, delayed bool) error {
	k := b.keys
	_, err := b.runScript(ctx, "drain", []string{
		k.Wait(), k.Paused(), k.Delayed(), k.Prioritized(), k.Repeat(),
	}, k.KeyPrefix(), boolToStr(delayed))
	return err
}

// Obliterate removes up to count jobs of the queue and returns how many
// batches remain: 0 once the queue is gone.
func (b *RedisBackend) Obliterate(ctx context.Context, force bool, count int64) (int64, error) {
	forceArg := ""
	if force {
		forceArg = "force"
	}
	res, err := b.runScript(ctx, "obliterate",
		[]string{b.keys.Meta(), b.keys.KeyPrefix()}, count, forceArg)
	if err != nil {
		return 0, err
	}
	remaining, _ := asInt64(res)
	switch {
	case remaining == -1:
		return 0, configError("cannot obliterate a queue that is not paused")
	case remaining == -2:
		return 0, configError("cannot obliterate a queue with active jobs")
	case remaining < 0:
		return 0, nil
	}
	return remaining, nil
}

// CleanJobsByState removes up to limit jobs of state older than timestamp.
func (b *RedisBackend) CleanJobsByState(ctx context.Context, state JobState, timestamp, limit int64) ([]string, error) {
	k := b.keys
	name := luaStateName(state)
	res, err := b.runScript(ctx, "cleanJobsInSet",
		[]string{k.Get(name), k.Events(), k.Repeat()},
		k.KeyPrefix(), timestamp, limit, name)
	if err != nil {
		return nil, err
	}
	return asStrings(res), nil
}

// RetryFinishedJobs moves up to count completed or failed jobs back to wait.
func (b *RedisBackend) RetryFinishedJobs(ctx context.Context, state JobState, count, timestamp int64) (int64, error) {
	return b.moveJobsToWait(ctx, string(state), count, timestamp)
}

// PromoteJobs moves up to count delayed jobs back to wait.
func (b *RedisBackend) PromoteJobs(ctx context.Context, count int64) (int64, error) {
	// The delayed set is scored by dueTimestamp*4096 (plus a counter), not by a
	// millisecond timestamp, so the cutoff must be the largest int64 to cover
	// every delayed job regardless of how far in the future it is due.
	return b.moveJobsToWait(ctx, "delayed", count, math.MaxInt64)
}

// moveJobsToWait invokes the moveJobsToWait script once. The script returns a
// cursor (1 when another batch of up to count jobs remains, 0 once complete),
// not a remaining-count.
func (b *RedisBackend) moveJobsToWait(ctx context.Context, state string, count, timestamp int64) (int64, error) {
	k := b.keys
	res, err := b.runScript(ctx, "moveJobsToWait", []string{
		k.KeyPrefix(), k.Events(), k.Get(state),
		k.Wait(), k.Paused(), k.Meta(),
		k.Active(), k.Marker(),
	}, count, timestamp, state)
	if err != nil {
		return 0, err
	}
	cursor, _ := asInt64(res)
	return cursor, nil
}

// GetCounts returns the number of jobs in each requested state.
func (b *RedisBackend) GetCounts(ctx context.Context, states []JobState) ([]int64, error) {
	args := make([]any, 0, len(states))
	for _, s := range states {
		args = append(args, luaStateName(s))
	}
	res, err := b.runScript(ctx, "getCounts", []string{b.keys.KeyPrefix()}, args...)
	if err != nil {
		return nil, err
	}
	arr, _ := res.([]any)
	counts := make([]int64, len(states))
	for i := range states {
		if i < len(arr) {
			counts[i], _ = asInt64(arr[i])
		}
	}
	return counts, nil
}

// GetRanges returns job ids of state, ordered by their position in the
// underlying list or sorted set.
func (b *RedisBackend) GetRanges(ctx context.Context, state JobState, start, end int64, asc bool) ([]string, error) {
	res, err := b.runScript(ctx, "getRanges", []string{b.keys.KeyPrefix()},
		start, end, boolToStr(asc), luaStateName(state))
	if err != nil {
		return nil, err
	}
	groups, _ := res.([]any)
	var ids []string
	for _, group := range groups {
		ids = append(ids, asStrings(group)...)
	}
	return ids, nil
}

// GetJobs returns the jobs in the requested state.
//
// It uses the shared `getJobs` command, which reads ids and job hashes in the
// same script, instead of GetRanges plus one GetJob lookup per id: besides
// saving N round trips for a range of N jobs, it avoids the race where a
// job's hash is removed after its id is read but before it would otherwise
// have been fetched individually.
func (b *RedisBackend) GetJobs(ctx context.Context, state JobState, start, end int64, asc bool) ([]*JobRecord, error) {
	res, err := b.runScript(ctx, "getJobs", []string{b.keys.KeyPrefix()},
		start, end, boolToStr(asc), getJobsMaxBackfillIterations, luaStateName(state))
	if err != nil {
		return nil, err
	}
	groups, _ := res.([]any)
	jobs := make([]*JobRecord, 0)
	for _, group := range groups {
		entries, ok := group.([]any)
		if !ok {
			continue
		}
		for _, entry := range entries {
			pair, ok := entry.([]any)
			if !ok || len(pair) != 2 {
				continue
			}
			jobID, ok := asString(pair[0])
			if !ok {
				continue
			}
			fields := flatToMap(pair[1])
			if len(fields) == 0 {
				continue
			}
			jobs = append(jobs, jobRecordFromHash(jobID, fields))
		}
	}
	return jobs, nil
}

// IsMaxed reports whether the queue reached its global concurrency limit.
func (b *RedisBackend) IsMaxed(ctx context.Context) (bool, error) {
	res, err := b.runScript(ctx, "isMaxed", []string{b.keys.Meta(), b.keys.Active()})
	if err != nil {
		return false, err
	}
	n, _ := asInt64(res)
	return n == 1, nil
}

// GetRateLimitTTL returns the remaining rate limit window in milliseconds.
func (b *RedisBackend) GetRateLimitTTL(ctx context.Context, maxJobs int64) (int64, error) {
	res, err := b.runScript(ctx, "getRateLimitTtl",
		[]string{b.keys.Limiter(), b.keys.Meta()}, strconv.FormatInt(maxJobs, 10))
	if err != nil {
		return 0, err
	}
	ttl, _ := asInt64(res)
	return ttl, nil
}

// GetMetrics returns the collected metrics for the completed or failed state.
func (b *RedisBackend) GetMetrics(ctx context.Context, state JobState, start, end int64) (*Metrics, error) {
	key := b.keys.Metrics(string(state))
	res, err := b.runScript(ctx, "getMetrics", []string{key, key + ":data"}, start, end)
	if err != nil {
		return nil, err
	}
	arr, _ := res.([]any)
	m := &Metrics{}
	if len(arr) > 0 {
		// HMGET replies positionally (count, prevTS, prevCount), not as
		// field/value pairs, so it must be decoded by index rather than
		// passed through flatToMap.
		meta, _ := arr[0].([]any)
		if len(meta) > 0 {
			if s, ok := asString(meta[0]); ok {
				m.Count = parseInt(s)
			}
		}
		if len(meta) > 1 {
			if s, ok := asString(meta[1]); ok {
				m.PrevTS = parseInt(s)
			}
		}
		if len(meta) > 2 {
			if s, ok := asString(meta[2]); ok {
				m.PrevCount = parseInt(s)
			}
		}
	}
	if len(arr) > 1 {
		points, _ := arr[1].([]any)
		m.Data = make([]int64, 0, len(points))
		for _, p := range points {
			n, _ := asInt64(p)
			m.Data = append(m.Data, n)
		}
	}
	if len(arr) > 2 {
		m.NumPoints, _ = asInt64(arr[2])
	}
	return m, nil
}

// GetClientList returns the output of CLIENT LIST.
func (b *RedisBackend) GetClientList(ctx context.Context) ([]string, error) {
	raw, err := b.rdb.ClientList(ctx).Result()
	if err != nil {
		return nil, err
	}
	return []string{raw}, nil
}

// SetQueueMeta sets fields of the queue metadata hash.
func (b *RedisBackend) SetQueueMeta(ctx context.Context, values map[string]any) error {
	if len(values) == 0 {
		return nil
	}
	return b.rdb.HSet(ctx, b.keys.Meta(), values).Err()
}

// GetQueueMetaField reads a field of the queue metadata hash.
func (b *RedisBackend) GetQueueMetaField(ctx context.Context, field string) (string, bool, error) {
	val, err := b.rdb.HGet(ctx, b.keys.Meta(), field).Result()
	if err == redis.Nil {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return val, true, nil
}

// RemoveQueueMetaFields deletes fields of the queue metadata hash.
func (b *RedisBackend) RemoveQueueMetaFields(ctx context.Context, fields ...string) error {
	if len(fields) == 0 {
		return nil
	}
	return b.rdb.HDel(ctx, b.keys.Meta(), fields...).Err()
}
