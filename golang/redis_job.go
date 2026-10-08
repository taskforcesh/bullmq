package bullmq

import (
	"context"
	"encoding/json"
	"strconv"
	"time"
)

// jobRecordFromHash rebuilds a job from its Redis hash representation.
func jobRecordFromHash(id string, fields map[string]string) *JobRecord {
	r := &JobRecord{
		ID:   id,
		Name: fields["name"],
		Opts: &JobOptions{},
	}
	if raw, ok := fields["data"]; ok && raw != "" {
		r.Data = json.RawMessage(raw)
	} else {
		r.Data = json.RawMessage("null")
	}
	if raw, ok := fields["opts"]; ok && raw != "" {
		_ = json.Unmarshal([]byte(raw), r.Opts)
	}
	if raw, ok := fields["progress"]; ok && raw != "" {
		_ = r.Progress.UnmarshalJSON([]byte(raw))
	}
	if raw, ok := fields["returnvalue"]; ok && raw != "" {
		r.ReturnValue = json.RawMessage(raw)
	}
	if raw, ok := fields["stacktrace"]; ok && raw != "" {
		_ = json.Unmarshal([]byte(raw), &r.Stacktrace)
	}
	if raw, ok := fields["parent"]; ok && raw != "" {
		var p ParentKeys
		if json.Unmarshal([]byte(raw), &p) == nil {
			r.Parent = &p
		}
	}
	r.ParentKey = fields["parentKey"]
	r.ProcessedBy = fields["pb"]
	r.RepeatJobKey = fields["rjk"]
	r.FailedReason = fields["failedReason"]
	r.DeferredFailure = fields["defa"]
	r.Timestamp = parseInt(fields["timestamp"])
	r.AttemptsMade = parseInt(fields["atm"])
	r.AttemptsStarted = parseInt(fields["ats"])
	r.ProcessedOn = parseInt(fields["processedOn"])
	r.FinishedOn = parseInt(fields["finishedOn"])
	r.StalledCounter = parseInt(fields["stc"])
	r.Priority = parseInt(fields["priority"])
	if raw, ok := fields["delay"]; ok && raw != "" {
		r.Delay = parseInt(raw)
	} else {
		r.Delay = r.Opts.delayMs()
	}
	return r
}

// packFailureFields encodes the `fieldsToUpdate` argument of the commands that
// record a failed attempt: a flat msgpack array of field, value pairs.
func packFailureFields(f *FailureInfo) []byte {
	if f == nil {
		return nil
	}
	trace, _ := json.Marshal(f.Stacktrace)
	w := newMsgpackWriter(len(f.Reason) + len(trace) + 32)
	w.ArrayLen(4)
	w.Str("failedReason")
	w.Str(f.Reason)
	w.Str("stacktrace")
	w.Str(string(trace))
	return w.Bytes()
}

// fieldsArg turns packed fields into a script argument, using the empty
// string for "no fields".
func fieldsArg(fields []byte) any {
	if len(fields) == 0 {
		return ""
	}
	return fields
}

// GetJob returns the stored job, or nil when it does not exist.
func (b *RedisBackend) GetJob(ctx context.Context, jobID string) (*JobRecord, error) {
	fields, err := b.rdb.HGetAll(ctx, b.keys.Job(jobID)).Result()
	if err != nil {
		return nil, err
	}
	if len(fields) == 0 {
		return nil, nil
	}
	return jobRecordFromHash(jobID, fields), nil
}

// GetState returns the state of a job.
func (b *RedisBackend) GetState(ctx context.Context, jobID string) (JobState, error) {
	k := b.keys
	res, err := b.runScript(ctx, "getState", []string{
		k.Completed(), k.Failed(), k.Delayed(), k.Active(),
		k.Wait(), k.Paused(), k.WaitingChildren(), k.Prioritized(),
	}, jobID)
	if err != nil {
		return StateUnknown, err
	}
	s, ok := asString(res)
	if !ok {
		return StateUnknown, nil
	}
	return JobState(s), nil
}

// UpdateData replaces the job payload.
func (b *RedisBackend) UpdateData(ctx context.Context, jobID string, data []byte) error {
	return b.runScriptStatus(ctx, "updateData", []string{b.keys.Job(jobID)}, string(data))
}

// UpdateProgress stores a new progress value and emits the progress event.
func (b *RedisBackend) UpdateProgress(ctx context.Context, jobID string, progress Progress) error {
	return b.runScriptStatus(ctx, "updateProgress",
		[]string{b.keys.Job(jobID), b.keys.Events(), b.keys.Meta()},
		jobID, progress.Raw())
}

// AddLog appends a row to the job log.
func (b *RedisBackend) AddLog(ctx context.Context, jobID, row string, keepLogs int64) (int64, error) {
	keep := ""
	if keepLogs > 0 {
		keep = strconv.FormatInt(keepLogs, 10)
	}
	res, err := b.runScript(ctx, "addLog",
		[]string{b.keys.Job(jobID), b.keys.JobLogs(jobID)},
		jobID, row, keep)
	if err != nil {
		return 0, err
	}
	code, _ := asInt64(res)
	if code < 0 {
		return 0, scriptError("addLog", code)
	}
	return code, nil
}

// GetJobLogs returns the log rows in [start, end] together with the total count.
func (b *RedisBackend) GetJobLogs(ctx context.Context, jobID string, start, end int64) ([]string, int64, error) {
	key := b.keys.JobLogs(jobID)
	rows, err := b.rdb.LRange(ctx, key, start, end).Result()
	if err != nil {
		return nil, 0, err
	}
	count, err := b.rdb.LLen(ctx, key).Result()
	if err != nil {
		return nil, 0, err
	}
	return rows, count, nil
}

// Remove deletes the job and optionally its children. It returns false when
// the job is locked by another worker.
func (b *RedisBackend) Remove(ctx context.Context, jobID string, removeChildren bool) (bool, error) {
	res, err := b.runScript(ctx, "removeJob",
		[]string{b.keys.Job(jobID), b.keys.Repeat()},
		jobID, boolToStr(removeChildren), b.keys.KeyPrefix())
	if err != nil {
		return false, err
	}
	code, ok := asInt64(res)
	if !ok {
		return true, nil
	}
	if code < 0 {
		return false, scriptError("removeJob", code)
	}
	return code != 0, nil
}

// Promote moves a delayed job to the wait list immediately.
func (b *RedisBackend) Promote(ctx context.Context, jobID string) error {
	k := b.keys
	return b.runScriptStatus(ctx, "promote", []string{
		k.Delayed(), k.Wait(), k.Paused(), k.Meta(),
		k.Prioritized(), k.Active(), k.PC(), k.Events(), k.Marker(),
	}, k.KeyPrefix(), jobID)
}

// ChangeDelay updates the delay of a job that is in the delayed set.
func (b *RedisBackend) ChangeDelay(ctx context.Context, jobID string, delay time.Duration) error {
	k := b.keys
	return b.runScriptStatus(ctx, "changeDelay", []string{
		k.Delayed(), k.Meta(), k.Marker(), k.Events(),
	}, delay.Milliseconds(), nowMillis(), jobID, k.Job(jobID))
}

// ChangePriority updates the priority of a waiting or prioritized job.
func (b *RedisBackend) ChangePriority(ctx context.Context, jobID string, priority int64, lifo bool) error {
	k := b.keys
	return b.runScriptStatus(ctx, "changePriority", []string{
		k.Wait(), k.Paused(), k.Meta(), k.Prioritized(),
		k.Active(), k.PC(), k.Marker(),
	}, priority, k.KeyPrefix(), jobID, boolToStr(lifo))
}

// pushCommand returns the list command that puts a job back in the wait list.
func pushCommand(lifo bool) string {
	if lifo {
		return "RPUSH"
	}
	return "LPUSH"
}

// RetryFinishedJob moves a completed or failed job back to the wait list.
func (b *RedisBackend) RetryFinishedJob(ctx context.Context, jobID string, state JobState, lifo bool) error {
	k := b.keys
	propVal := "returnvalue"
	if state == StateFailed {
		propVal = "failedReason"
	}
	res, err := b.runScript(ctx, "reprocessJob", []string{
		k.Job(jobID), k.Events(), k.Get(string(state)),
		k.Wait(), k.Meta(), k.Active(), k.Marker(),
	}, jobID, pushCommand(lifo), propVal, string(state), "0", "0")
	if err != nil {
		return err
	}
	if code, _ := asInt64(res); code != 1 {
		return scriptError("reprocessJob", code)
	}
	return nil
}

// RetryJob puts an active job straight back into the wait list.
func (b *RedisBackend) RetryJob(ctx context.Context, jobID, token string, lifo bool, failure *FailureInfo) error {
	k := b.keys
	return b.runScriptStatus(ctx, "retryJob", []string{
		k.Active(), k.Wait(), k.Paused(), k.Job(jobID), k.Meta(), k.Events(),
		k.Delayed(), k.Prioritized(), k.PC(), k.Marker(), k.Stalled(),
	}, k.KeyPrefix(), nowMillis(), pushCommand(lifo), jobID, token, fieldsArg(packFailureFields(failure)))
}

// MoveToDelayed reschedules an active job.
func (b *RedisBackend) MoveToDelayed(ctx context.Context, jobID, token string, delay time.Duration, opts MoveToDelayedOptions) error {
	k := b.keys
	ms := delay.Milliseconds()
	if ms < 0 {
		ms = 0
	}
	return b.runScriptStatus(ctx, "moveToDelayed", []string{
		k.Marker(), k.Active(), k.Prioritized(), k.Delayed(),
		k.Job(jobID), k.Events(), k.Meta(), k.Stalled(),
		k.Wait(), k.Limiter(), k.PC(),
	},
		k.KeyPrefix(), nowMillis(), jobID, token, ms,
		boolToStr(opts.SkipAttempt),
		fieldsArg(packFailureFields(opts.Failure)),
		"0", // do not fetch the next job
		"",  // unused when not fetching
	)
}

// MoveToWaitingChildren parks an active parent job until its children finish.
func (b *RedisBackend) MoveToWaitingChildren(ctx context.Context, jobID, token string, child *ParentKeys) (bool, error) {
	k := b.keys
	if token == "" {
		token = "0"
	}
	childKey := ""
	if child != nil && child.ID != "" {
		childKey = child.QueueKey + ":" + child.ID
	}
	res, err := b.runScript(ctx, "moveToWaitingChildren", []string{
		k.Active(), k.WaitingChildren(), k.Job(jobID),
		k.Dependencies(jobID), k.Job(jobID) + ":unsuccessful",
		k.Stalled(), k.Events(),
	}, token, childKey, nowMillis(), jobID, k.KeyPrefix())
	if err != nil {
		return false, err
	}
	code, _ := asInt64(res)
	switch {
	case code < 0:
		return false, scriptError("moveToWaitingChildren", code)
	case code == 1:
		return false, nil
	default:
		return true, nil
	}
}

// ExtendLock refreshes the lock held on an active job.
func (b *RedisBackend) ExtendLock(ctx context.Context, jobID, token string, duration time.Duration) error {
	res, err := b.runScript(ctx, "extendLock",
		[]string{b.keys.JobLock(jobID), b.keys.Stalled()},
		token, duration.Milliseconds(), jobID)
	if err != nil {
		return err
	}
	if code, ok := asInt64(res); !ok || code != 1 {
		return ErrJobLockNotExist
	}
	return nil
}

// ExtendLocks renews the locks of the given jobs with one script call and
// returns the ids whose lock could not be renewed (missing or owned by
// another token).
func (b *RedisBackend) ExtendLocks(ctx context.Context, locks []JobLock, duration time.Duration) ([]string, error) {
	tokens := newMsgpackWriter(16 * len(locks))
	tokens.ArrayLen(len(locks))
	ids := newMsgpackWriter(8 * len(locks))
	ids.ArrayLen(len(locks))
	for _, l := range locks {
		tokens.Str(l.Token)
		ids.Str(l.JobID)
	}

	res, err := b.runScript(ctx, "extendLocks", []string{b.keys.Stalled()},
		b.keys.KeyPrefix(), tokens.Bytes(), ids.Bytes(), duration.Milliseconds())
	if err != nil {
		return nil, err
	}
	return asStrings(res), nil
}
