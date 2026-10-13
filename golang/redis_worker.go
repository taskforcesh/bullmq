package bullmq

import (
	"context"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// MoveToActive atomically moves the next job to the active list and locks it.
// The result carries a nil Job when none is available; Wait is then how long
// to wait before the next attempt (rate limit or next delayed job).
func (b *RedisBackend) MoveToActive(ctx context.Context, opts MoveToActiveOptions) (*FetchResult, error) {
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

// parseFetchResult decodes the `{jobData, jobId, limitUntil, delayUntil}` reply
// of the moveToActive command.
func parseFetchResult(res any) *FetchResult {
	arr, ok := res.([]any)
	if !ok || len(arr) < 2 {
		return &FetchResult{}
	}
	fields := flatToMap(arr[0])
	jobID, _ := asString(arr[1])
	if len(fields) == 0 || jobID == "" {
		var wait time.Duration
		if len(arr) > 2 {
			if ms, _ := asInt64(arr[2]); ms > 0 {
				wait = time.Duration(ms) * time.Millisecond
			}
		}
		if len(arr) > 3 && wait == 0 {
			if ts, _ := asInt64(arr[3]); ts > 0 {
				if d := time.Until(time.UnixMilli(ts)); d > 0 {
					wait = d
				}
			}
		}
		return &FetchResult{Wait: wait}
	}
	return &FetchResult{Job: jobRecordFromHash(jobID, fields)}
}

func packMoveToActiveOpts(opts MoveToActiveOptions) ([]byte, error) {
	m := map[string]any{
		"token":        opts.Token,
		"lockDuration": opts.LockDuration.Milliseconds(),
	}
	if opts.WorkerName != "" {
		m["name"] = opts.WorkerName
	}
	if l := opts.Limiter; l != nil {
		m["limiter"] = l.msgpackValue()
	}
	return packMsgpack(m)
}

// MoveToCompleted moves an active job into the completed set.
func (b *RedisBackend) MoveToCompleted(ctx context.Context, jobID string, returnValue []byte, opts FinishOptions) (int64, error) {
	return b.moveToFinished(ctx, jobID, "completed", "returnvalue", string(returnValue), nil, opts)
}

// MoveToFailed moves an active job into the failed set.
func (b *RedisBackend) MoveToFailed(ctx context.Context, jobID string, failure FailureInfo, opts FinishOptions) (int64, error) {
	fields, err := packFailureFields(&failure)
	if err != nil {
		return 0, err
	}
	return b.moveToFinished(ctx, jobID, "failed", "failedReason", failure.Reason, fields, opts)
}

// moveToFinished moves an active job into the completed or failed set. The
// fetch-next flag is never set: the worker's fetch loop owns fetching.
func (b *RedisBackend) moveToFinished(ctx context.Context, jobID, target, field, value string, fieldsToUpdate []byte, opts FinishOptions) (int64, error) {
	k := b.keys
	keys := []string{
		k.Wait(), k.Active(), k.Prioritized(), k.Events(), k.Stalled(),
		k.Limiter(), k.Delayed(), k.Paused(), k.Meta(), k.PC(),
		k.Get(target), k.Job(jobID), k.Metrics(target), k.Marker(),
	}

	finishedOn := nowMillis()
	packed, err := packMoveToFinishedOpts(opts)
	if err != nil {
		return 0, err
	}
	res, err := b.runScript(ctx, "moveToFinished", keys,
		jobID, finishedOn, field, value, target,
		"0",
		k.KeyPrefix(),
		packed,
		fieldsArg(fieldsToUpdate),
	)
	if err != nil {
		return 0, err
	}
	if code, ok := asInt64(res); ok && code < 0 {
		return 0, scriptError("moveToFinished", code)
	}
	return finishedOn, nil
}

func packMoveToFinishedOpts(opts FinishOptions) ([]byte, error) {
	maxMetricsSize := ""
	if opts.Metrics != nil && opts.Metrics.MaxDataPoints > 0 {
		maxMetricsSize = strconv.FormatInt(opts.Metrics.MaxDataPoints, 10)
	}

	// The Lua command indexes keepJobs, so it must always be a table.
	keepJobs := map[string]any{}
	if opts.KeepJobs != nil {
		keepJobs = opts.KeepJobs.msgpackValue()
	}

	// The job option accessors are nil-safe.
	jobOpts := opts.JobOpts

	m := map[string]any{
		"token":          opts.Token,
		"keepJobs":       keepJobs,
		"lockDuration":   opts.LockDuration.Milliseconds(),
		"attempts":       jobOpts.attemptsVal(),
		"maxMetricsSize": maxMetricsSize,
		"fpof":           jobOpts.failParentOnFailureVal(),
		"cpof":           jobOpts.continueParentOnFailureVal(),
		"idof":           jobOpts.ignoreDependencyOnFailureVal(),
		"rdof":           jobOpts.removeDependencyOnFailureVal(),
	}
	if opts.WorkerName != "" {
		m["name"] = opts.WorkerName
	}
	if l := opts.Limiter; l != nil {
		m["limiter"] = l.msgpackValue()
	}
	return packMsgpack(m)
}

// MoveStalledJobsToWait moves jobs whose lock expired back to the wait list
// and returns their ids.
func (b *RedisBackend) MoveStalledJobsToWait(ctx context.Context, opts StalledOptions) ([]string, error) {
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

// WaitForJob blocks on the marker key until a job shows up, a delayed job comes
// due, or timeout elapses.
func (b *RedisBackend) WaitForJob(ctx context.Context, timeout time.Duration) error {
	if timeout < time.Millisecond {
		timeout = time.Millisecond
	}
	marker := b.keys.Marker()

	var err error
	if b.blockingOwned {
		// BZPOPMIN is issued through Do so that sub-second timeouts are
		// preserved; the typed helper in go-redis rounds them up to a full
		// second. The dedicated client's read timeout outlasts the block while
		// still guarding against a dead socket.
		err = b.blocking.Do(ctx, "bzpopmin", marker, timeout.Seconds()).Err()
	} else {
		// A caller-supplied client we could not clone has its own read
		// timeout, which raw commands would be subject to. The typed command
		// carries the blocking timeout so go-redis extends the read deadline,
		// but only supports whole seconds; shorter waits just sleep.
		whole := timeout.Truncate(time.Second)
		if whole < time.Second {
			if !sleepCtx(ctx, timeout) {
				return ctx.Err()
			}
			return nil
		}
		err = b.blocking.BZPopMin(ctx, whole, marker).Err()
	}
	if err == redis.Nil {
		return nil
	}
	return err
}

// LastEventID returns the id of the newest event stream entry, or "0-0" when
// the stream is empty.
func (b *RedisBackend) LastEventID(ctx context.Context) (string, error) {
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
func (b *RedisBackend) ReadEvents(ctx context.Context, lastID string, block time.Duration) ([]QueueEvent, error) {
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

	var events []QueueEvent
	for _, stream := range streams {
		for _, msg := range stream.Messages {
			ev := QueueEvent{ID: msg.ID, Data: make(map[string]string, len(msg.Values))}
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
