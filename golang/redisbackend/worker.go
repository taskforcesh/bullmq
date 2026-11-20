package redisbackend

import (
	"context"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
	bullmq "github.com/taskforcesh/bullmq-go"
)

const blockingPollInterval = time.Second

// MoveToActive atomically moves the next job to the active list and locks it.
// The result carries a nil Job when none is available, with the rate limit or
// the next delayed job that explains why.
func (b *Backend) MoveToActive(ctx context.Context, opts bullmq.MoveToActiveOptions) (*bullmq.FetchResult, error) {
	k := b.keys
	packed, err := packMoveToActiveOpts(opts)
	if err != nil {
		return nil, err
	}
	res, err := b.runScript(ctx, "moveToActive", []string{
		k.Wait(), k.Active(), k.Prioritized(), k.Events(), k.Stalled(),
		k.Limiter(), k.Delayed(), k.Paused(), k.Meta(), k.PC(), k.Marker(),
	}, k.KeyPrefix(), nowMillis(), packed)
	if err != nil {
		return nil, err
	}
	return parseFetchResult(res), nil
}

// parseFetchResult decodes the `{jobData, jobId, rateLimitDelay, delayUntil}`
// reply of the moveToActive command and of the commands that fetch the next
// job. Any other reply, such as the 0 returned when there is nothing to fetch,
// is an empty result.
func parseFetchResult(res any) *bullmq.FetchResult {
	arr, ok := res.([]any)
	if !ok || len(arr) < 2 {
		return &bullmq.FetchResult{}
	}
	fields := flatToMap(arr[0])
	jobID, _ := asString(arr[1])
	if len(fields) > 0 && jobID != "" {
		return &bullmq.FetchResult{Job: jobRecordFromHash(jobID, fields)}
	}
	r := &bullmq.FetchResult{}
	if len(arr) > 2 {
		if ms, _ := asInt64(arr[2]); ms > 0 {
			r.RateLimitDelay = time.Duration(ms) * time.Millisecond
		}
	}
	if len(arr) > 3 {
		if ts, _ := asInt64(arr[3]); ts > 0 {
			r.NextDelayedAt = ts
		}
	}
	return r
}

func packMoveToActiveOpts(opts bullmq.MoveToActiveOptions) ([]byte, error) {
	m := map[string]any{
		"token":        opts.Token,
		"lockDuration": opts.LockDuration.Milliseconds(),
	}
	if opts.WorkerName != "" {
		m["name"] = opts.WorkerName
	}
	if l := opts.Limiter; l != nil {
		m["limiter"] = limiterValue(l)
	}
	return packMsgpack(m)
}

// MoveToCompleted moves an active job into the completed set and, when
// requested, fetches the next job.
func (b *Backend) MoveToCompleted(ctx context.Context, jobID string, returnValue []byte, opts bullmq.FinishOptions) (*bullmq.FinishResult, error) {
	return b.moveToFinished(ctx, jobID, "completed", "returnvalue", string(returnValue), nil, opts)
}

// MoveToFailed moves an active job into the failed set and, when requested,
// fetches the next job.
func (b *Backend) MoveToFailed(ctx context.Context, jobID string, failure bullmq.FailureInfo, opts bullmq.FinishOptions) (*bullmq.FinishResult, error) {
	fields, err := packFailureFields(&failure)
	if err != nil {
		return nil, err
	}
	return b.moveToFinished(ctx, jobID, "failed", "failedReason", failure.Reason, fields, opts)
}

// moveToFinished moves an active job into the completed or failed set. With
// fetch-next the command locks the next job with the same token, using the
// lock settings packed in its options.
func (b *Backend) moveToFinished(ctx context.Context, jobID, target, field, value string, fieldsToUpdate []byte, opts bullmq.FinishOptions) (*bullmq.FinishResult, error) {
	k := b.keys
	keys := []string{
		k.Wait(), k.Active(), k.Prioritized(), k.Events(), k.Stalled(),
		k.Limiter(), k.Delayed(), k.Paused(), k.Meta(), k.PC(),
		k.Get(target), k.Job(jobID), k.Metrics(target), k.Marker(),
	}

	finishedOn := nowMillis()
	packed, err := packMoveToFinishedOpts(opts)
	if err != nil {
		return nil, err
	}
	res, err := b.runScript(ctx, "moveToFinished", keys,
		jobID, finishedOn, field, value, target,
		boolToStr(opts.FetchNext),
		k.KeyPrefix(),
		packed,
		fieldsArg(fieldsToUpdate),
	)
	if err != nil {
		return nil, err
	}
	if code, ok := asInt64(res); ok && code < 0 {
		return nil, scriptError("moveToFinished", code)
	}
	result := &bullmq.FinishResult{FinishedOn: finishedOn}
	if opts.FetchNext {
		result.Next = parseFetchResult(res)
	}
	return result, nil
}

func packMoveToFinishedOpts(opts bullmq.FinishOptions) ([]byte, error) {
	maxMetricsSize := ""
	if opts.Metrics != nil && opts.Metrics.MaxDataPoints > 0 {
		maxMetricsSize = strconv.FormatInt(opts.Metrics.MaxDataPoints, 10)
	}

	// The Lua command indexes keepJobs, so it must always be a table.
	keepJobs := map[string]any{}
	if opts.KeepJobs != nil {
		keepJobs = keepJobsValue(opts.KeepJobs)
	}

	jobOpts := opts.JobOpts
	if jobOpts == nil {
		jobOpts = &bullmq.JobOptions{}
	}

	m := map[string]any{
		"token":          opts.Token,
		"keepJobs":       keepJobs,
		"lockDuration":   opts.LockDuration.Milliseconds(),
		"attempts":       int64Val(jobOpts.Attempts),
		"maxMetricsSize": maxMetricsSize,
		"fpof":           boolVal(jobOpts.FailParentOnFailure),
		"cpof":           boolVal(jobOpts.ContinueParentOnFailure),
		"idof":           boolVal(jobOpts.IgnoreDependencyOnFailure),
		"rdof":           boolVal(jobOpts.RemoveDependencyOnFailure),
	}
	if opts.WorkerName != "" {
		m["name"] = opts.WorkerName
	}
	if l := opts.Limiter; l != nil {
		m["limiter"] = limiterValue(l)
	}
	return packMsgpack(m)
}

// MoveStalledJobsToWait moves jobs whose lock expired back to the wait list
// and returns their ids.
func (b *Backend) MoveStalledJobsToWait(ctx context.Context, opts bullmq.StalledOptions) ([]string, error) {
	k := b.keys
	res, err := b.runScript(ctx, "moveStalledJobsToWait", []string{
		k.Stalled(), k.Wait(), k.Active(), k.StalledCheck(), k.Meta(),
		k.Paused(), k.Marker(), k.Events(), k.Repeat(),
	},
		opts.MaxStalledCount,
		k.KeyPrefix(),
		nowMillis(),
		opts.Interval.Milliseconds(),
	)
	if err != nil {
		return nil, err
	}
	return asStrings(res), nil
}

// WaitForJob blocks on the marker key until a job shows up, a delayed job is
// scheduled, or timeout elapses. The popped marker tells which: its score is
// 0 for "a job may be ready" and the due time of the next delayed job
// otherwise.
func (b *Backend) WaitForJob(ctx context.Context, timeout time.Duration) (bullmq.WaitResult, error) {
	if timeout < time.Millisecond {
		timeout = time.Millisecond
	}
	marker := b.keys.Marker()
	deadline := time.Now().Add(timeout)

	for {
		if err := ctx.Err(); err != nil {
			return bullmq.WaitResult{}, err
		}
		wait := time.Until(deadline)
		if wait <= 0 {
			return bullmq.WaitResult{}, nil
		}
		if wait > blockingPollInterval {
			wait = blockingPollInterval
		}

		var score float64
		var err error
		if b.blockingOwned {
			// BZPOPMIN is issued through Do so that sub-second timeouts are
			// preserved; the typed helper in go-redis rounds them up to a full
			// second. The dedicated client's read timeout outlasts the block while
			// still guarding against a dead socket.
			var reply any
			reply, err = b.blocking.Do(ctx, "bzpopmin", marker, wait.Seconds()).Result()
			if err == nil {
				score = markerScore(reply)
			}
		} else {
			// A caller-supplied client we could not clone has its own read
			// timeout, which raw commands would be subject to. The typed command
			// carries the blocking timeout so go-redis extends the read deadline,
			// but only supports whole seconds; shorter waits just sleep.
			whole := wait.Truncate(time.Second)
			if whole < time.Second {
				if !sleepCtx(ctx, wait) {
					return bullmq.WaitResult{}, ctx.Err()
				}
				return bullmq.WaitResult{}, nil
			}
			var z *redis.ZWithKey
			z, err = b.blocking.BZPopMin(ctx, whole, marker).Result()
			if err == nil {
				score = z.Score
			}
		}
		if err == redis.Nil {
			continue
		}
		if err != nil {
			return bullmq.WaitResult{}, err
		}
		res := bullmq.WaitResult{Woken: true}
		if score > 0 {
			res.NextDelayedAt = int64(score)
		}
		return res, nil
	}
}

// markerScore extracts the score of a raw `[key, member, score]` BZPOPMIN
// reply. The score is a string over RESP2 and a double over RESP3.
func markerScore(reply any) float64 {
	arr, ok := reply.([]any)
	if !ok || len(arr) < 3 {
		return 0
	}
	switch v := arr[2].(type) {
	case float64:
		return v
	case int64:
		return float64(v)
	case string:
		f, _ := strconv.ParseFloat(v, 64)
		return f
	default:
		return 0
	}
}

// SetRateLimit makes the limiter key report a full window for ttl, as Node's
// setRateLimit does.
func (b *Backend) SetRateLimit(ctx context.Context, ttl time.Duration) error {
	ms := ttl.Milliseconds()
	if ms < 1 {
		return configError("rate limit ttl must be at least 1ms, got %v", ttl)
	}
	return b.rdb.Set(ctx, b.keys.Limiter(), maxSafeInteger, time.Duration(ms)*time.Millisecond).Err()
}

// maxSafeInteger is the limiter counter Node stores to saturate the window
// (Number.MAX_SAFE_INTEGER), so every port reads the same value.
const maxSafeInteger int64 = 1<<53 - 1

// SignalWork adds the base marker that WaitForJob blocks on.
func (b *Backend) SignalWork(ctx context.Context) error {
	return b.rdb.ZAdd(ctx, b.keys.Marker(), redis.Z{Score: 0, Member: "0"}).Err()
}

// LastEventID returns the id of the newest event stream entry, or "0-0" when
// the stream is empty.
func (b *Backend) LastEventID(ctx context.Context) (string, error) {
	messages, err := b.blocking.XRevRangeN(ctx, b.keys.Events(), "+", "-", 1).Result()
	if err != nil {
		return "", err
	}
	if len(messages) == 0 {
		return "0-0", nil
	}
	return messages[0].ID, nil
}

// ReadEvents blocks up to block waiting for event stream entries newer than
// lastID.
func (b *Backend) ReadEvents(ctx context.Context, lastID string, block time.Duration) ([]bullmq.QueueEvent, error) {
	streams, err := b.blocking.XRead(ctx, &redis.XReadArgs{
		Streams: []string{b.keys.Events(), lastID},
		Block:   block,
	}).Result()
	if err == redis.Nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var events []bullmq.QueueEvent
	for _, stream := range streams {
		for _, msg := range stream.Messages {
			ev := bullmq.QueueEvent{ID: msg.ID, Data: make(map[string]string, len(msg.Values))}
			for k, v := range msg.Values {
				s, _ := asString(v)
				ev.Data[k] = s
			}
			ev.Event = ev.Data["event"]
			ev.JobID = ev.Data["jobId"]
			events = append(events, ev)
		}
	}
	return events, nil
}
