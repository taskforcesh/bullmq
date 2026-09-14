package bullmq

import (
	"context"
	"encoding/json"
	"strconv"
	"time"
)

// ParentKeys identifies the parent of a job as persisted in Redis.
type ParentKeys struct {
	// ID is the parent job id.
	ID string `json:"id"`
	// QueueKey is the fully qualified `{prefix}:{queueName}` parent queue key.
	QueueKey string `json:"queueKey"`
}

// Job is a unit of work stored in a queue.
//
// Values returned by Queue and Worker methods carry a live Redis context, so
// mutating methods such as UpdateProgress or Log can be called on them.
type Job struct {
	// ID is the job id.
	ID string
	// Name is the job name.
	Name string
	// Data is the JSON encoded payload.
	Data json.RawMessage
	// Opts are the options the job was created with.
	Opts *JobOptions
	// Progress is the last reported progress value.
	Progress Progress
	// AttemptsMade is how many times the job has finished an attempt.
	AttemptsMade int64
	// AttemptsStarted is how many times the job has been moved to active.
	AttemptsStarted int64
	// Timestamp is the creation time in Unix milliseconds.
	Timestamp int64
	// ProcessedOn is when the job was last moved to active, in Unix milliseconds.
	ProcessedOn int64
	// FinishedOn is when the job completed or failed, in Unix milliseconds.
	FinishedOn int64
	// FailedReason is the error message of the last failure.
	FailedReason string
	// Stacktrace holds the recorded failure traces.
	Stacktrace []string
	// ReturnValue is the JSON encoded value returned by the processor.
	ReturnValue json.RawMessage
	// ParentKey is the Redis key of the parent job, if any.
	ParentKey string
	// Parent identifies the parent job, if any.
	Parent *ParentKeys
	// ProcessedBy is the name of the worker that last processed the job.
	ProcessedBy string
	// StalledCounter is how many times the job has been detected as stalled.
	StalledCounter int64
	// Delay is the configured delay in milliseconds.
	Delay int64
	// Priority is the configured priority.
	Priority int64
	// RepeatJobKey links the job to a job scheduler.
	RepeatJobKey string
	// QueueName is the name of the owning queue.
	QueueName string

	c            *client
	token        string
	lockDuration time.Duration
	discarded    bool
}

// jobFromHash rebuilds a Job from its Redis hash representation.
func jobFromHash(c *client, id string, fields map[string]string) *Job {
	j := &Job{
		ID:        id,
		Name:      fields["name"],
		Opts:      &JobOptions{},
		c:         c,
		QueueName: c.keys.Name(),
	}
	if raw, ok := fields["data"]; ok && raw != "" {
		j.Data = json.RawMessage(raw)
	} else {
		j.Data = json.RawMessage("null")
	}
	if raw, ok := fields["opts"]; ok && raw != "" {
		_ = json.Unmarshal([]byte(raw), j.Opts)
	}
	if raw, ok := fields["progress"]; ok && raw != "" {
		_ = j.Progress.UnmarshalJSON([]byte(raw))
	}
	if raw, ok := fields["returnvalue"]; ok && raw != "" {
		j.ReturnValue = json.RawMessage(raw)
	}
	if raw, ok := fields["stacktrace"]; ok && raw != "" {
		_ = json.Unmarshal([]byte(raw), &j.Stacktrace)
	}
	if raw, ok := fields["parent"]; ok && raw != "" {
		var p ParentKeys
		if json.Unmarshal([]byte(raw), &p) == nil {
			j.Parent = &p
		}
	}
	j.ParentKey = fields["parentKey"]
	j.ProcessedBy = fields["pb"]
	j.RepeatJobKey = fields["rjk"]
	j.FailedReason = fields["failedReason"]
	j.Timestamp = parseInt(fields["timestamp"])
	j.AttemptsMade = parseInt(fields["atm"])
	j.AttemptsStarted = parseInt(fields["ats"])
	j.ProcessedOn = parseInt(fields["processedOn"])
	j.FinishedOn = parseInt(fields["finishedOn"])
	j.StalledCounter = parseInt(fields["stc"])
	j.Priority = parseInt(fields["priority"])
	if raw, ok := fields["delay"]; ok && raw != "" {
		j.Delay = parseInt(raw)
	} else {
		j.Delay = j.Opts.Delay
	}
	return j
}

func parseInt(s string) int64 {
	if s == "" {
		return 0
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		f, ferr := strconv.ParseFloat(s, 64)
		if ferr != nil {
			return 0
		}
		return int64(f)
	}
	return n
}

// Token returns the lock token held by the worker currently processing the job.
func (j *Job) Token() string { return j.token }

// Discard marks the job so that it is not retried when the processor fails.
func (j *Job) Discard() { j.discarded = true }

// Discarded reports whether Discard was called.
func (j *Job) Discarded() bool { return j.discarded }

// DecodeData unmarshals the job payload into out.
func (j *Job) DecodeData(out any) error {
	if len(j.Data) == 0 {
		return nil
	}
	return json.Unmarshal(j.Data, out)
}

// DecodeReturnValue unmarshals the processor result into out.
func (j *Job) DecodeReturnValue(out any) error {
	if len(j.ReturnValue) == 0 {
		return nil
	}
	return json.Unmarshal(j.ReturnValue, out)
}

func (j *Job) ctx() (*client, error) {
	if j.c == nil {
		return nil, ErrNoContext
	}
	return j.c, nil
}

// UpdateProgress stores a new progress value and emits a `progress` event.
func (j *Job) UpdateProgress(ctx context.Context, progress Progress) error {
	c, err := j.ctx()
	if err != nil {
		return err
	}
	if err := c.runScriptStatus(ctx, "updateProgress",
		[]string{c.keys.Job(j.ID), c.keys.Events(), c.keys.Meta()},
		j.ID, progress.Raw(),
	); err != nil {
		return err
	}
	j.Progress = progress
	return nil
}

// UpdateData replaces the job payload.
func (j *Job) UpdateData(ctx context.Context, data any) error {
	c, err := j.ctx()
	if err != nil {
		return err
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	if err := c.runScriptStatus(ctx, "updateData",
		[]string{c.keys.Job(j.ID)}, string(raw)); err != nil {
		return err
	}
	j.Data = raw
	return nil
}

// Log appends a row to the job log and returns the total number of rows kept.
func (j *Job) Log(ctx context.Context, message string) (int64, error) {
	c, err := j.ctx()
	if err != nil {
		return 0, err
	}
	keepLogs := ""
	if j.Opts != nil && j.Opts.KeepLogs > 0 {
		keepLogs = strconv.FormatInt(j.Opts.KeepLogs, 10)
	}
	res, err := c.runScript(ctx, "addLog",
		[]string{c.keys.Job(j.ID), c.keys.JobLogs(j.ID)},
		j.ID, message, keepLogs)
	if err != nil {
		return 0, err
	}
	code, _ := asInt64(res)
	if code < 0 {
		return 0, scriptError("addLog", code)
	}
	return code, nil
}

// Logs returns the log rows of the job together with the total count.
func (j *Job) Logs(ctx context.Context, start, end int64) ([]string, int64, error) {
	c, err := j.ctx()
	if err != nil {
		return nil, 0, err
	}
	key := c.keys.JobLogs(j.ID)
	rows, err := c.rdb.LRange(ctx, key, start, end).Result()
	if err != nil {
		return nil, 0, err
	}
	count, err := c.rdb.LLen(ctx, key).Result()
	if err != nil {
		return nil, 0, err
	}
	return rows, count, nil
}

// State returns the current state of the job.
func (j *Job) State(ctx context.Context) (JobState, error) {
	c, err := j.ctx()
	if err != nil {
		return StateUnknown, err
	}
	return jobState(ctx, c, j.ID)
}

func jobState(ctx context.Context, c *client, jobID string) (JobState, error) {
	res, err := c.runScript(ctx, "getState", []string{
		c.keys.Completed(), c.keys.Failed(), c.keys.Delayed(), c.keys.Active(),
		c.keys.Wait(), c.keys.Paused(), c.keys.WaitingChildren(), c.keys.Prioritized(),
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

// Remove deletes the job and all of its data. Active jobs cannot be removed.
func (j *Job) Remove(ctx context.Context, removeChildren bool) error {
	c, err := j.ctx()
	if err != nil {
		return err
	}
	return c.runScriptStatus(ctx, "removeJob",
		[]string{c.keys.Job(j.ID), c.keys.Repeat()},
		j.ID, boolToStr(removeChildren), c.keys.KeyPrefix())
}

// Promote moves a delayed job to the wait list immediately.
func (j *Job) Promote(ctx context.Context) error {
	c, err := j.ctx()
	if err != nil {
		return err
	}
	return c.runScriptStatus(ctx, "promote", []string{
		c.keys.Delayed(), c.keys.Wait(), c.keys.Paused(), c.keys.Meta(),
		c.keys.Prioritized(), c.keys.Active(), c.keys.PC(), c.keys.Events(), c.keys.Marker(),
	}, c.keys.KeyPrefix(), j.ID)
}

// ChangeDelay updates the delay of a job that is in the delayed set.
func (j *Job) ChangeDelay(ctx context.Context, delay time.Duration) error {
	c, err := j.ctx()
	if err != nil {
		return err
	}
	ms := delay.Milliseconds()
	if err := c.runScriptStatus(ctx, "changeDelay", []string{
		c.keys.Delayed(), c.keys.Meta(), c.keys.Marker(), c.keys.Events(),
	}, ms, nowMillis(), j.ID, c.keys.Job(j.ID)); err != nil {
		return err
	}
	j.Delay = ms
	return nil
}

// ChangePriority updates the priority of a waiting or prioritized job.
func (j *Job) ChangePriority(ctx context.Context, priority int64, lifo bool) error {
	c, err := j.ctx()
	if err != nil {
		return err
	}
	if err := c.runScriptStatus(ctx, "changePriority", []string{
		c.keys.Wait(), c.keys.Paused(), c.keys.Meta(), c.keys.Prioritized(),
		c.keys.Active(), c.keys.PC(), c.keys.Marker(),
	}, priority, c.keys.KeyPrefix(), j.ID, boolToStr(lifo)); err != nil {
		return err
	}
	j.Priority = priority
	return nil
}

// Retry moves a completed or failed job back to the wait list.
//
// state must be either StateCompleted or StateFailed.
func (j *Job) Retry(ctx context.Context, state JobState) error {
	c, err := j.ctx()
	if err != nil {
		return err
	}
	if state != StateCompleted && state != StateFailed {
		return configError("retry state must be %q or %q", StateCompleted, StateFailed)
	}
	pushCmd := "LPUSH"
	if j.Opts != nil && j.Opts.LIFO {
		pushCmd = "RPUSH"
	}
	propVal := "returnvalue"
	if state == StateFailed {
		propVal = "failedReason"
	}
	res, err := c.runScript(ctx, "reprocessJob", []string{
		c.keys.Job(j.ID), c.keys.Events(), c.keys.Get(string(state)),
		c.keys.Wait(), c.keys.Meta(), c.keys.Active(), c.keys.Marker(),
	}, j.ID, pushCmd, propVal, string(state), "0", "0")
	if err != nil {
		return err
	}
	if code, _ := asInt64(res); code != 1 {
		return scriptError("reprocessJob", code)
	}
	return nil
}

// IsCompleted reports whether the job finished successfully.
func (j *Job) IsCompleted(ctx context.Context) (bool, error) {
	state, err := j.State(ctx)
	return state == StateCompleted, err
}

// IsFailed reports whether the job finished with an error.
func (j *Job) IsFailed(ctx context.Context) (bool, error) {
	state, err := j.State(ctx)
	return state == StateFailed, err
}

// ExtendLock refreshes the lock held on an active job.
func (j *Job) ExtendLock(ctx context.Context, duration time.Duration) error {
	c, err := j.ctx()
	if err != nil {
		return err
	}
	if j.token == "" {
		return ErrJobLockNotExist
	}
	res, err := c.runScript(ctx, "extendLock",
		[]string{c.keys.JobLock(j.ID), c.keys.Stalled()},
		j.token, duration.Milliseconds(), j.ID)
	if err != nil {
		return err
	}
	if code, ok := asInt64(res); !ok || code != 1 {
		return ErrJobLockNotExist
	}
	return nil
}

// MoveToDelayed reschedules an active job. Processors should return [ErrDelayed]
// afterwards so the worker does not also move the job to a finished state.
//
// The current attempt is not counted, matching the Node.js implementation.
func (j *Job) MoveToDelayed(ctx context.Context, delay time.Duration) error {
	return j.moveToDelayed(ctx, delay, true)
}

// moveToDelayed reschedules an active job. When skipAttempt is false the
// attemptsMade counter is incremented, which is what the worker needs when it
// retries a failed job with a backoff.
func (j *Job) moveToDelayed(ctx context.Context, delay time.Duration, skipAttempt bool) error {
	c, err := j.ctx()
	if err != nil {
		return err
	}
	token := j.token
	if token == "" {
		token = "0"
	}
	ms := delay.Milliseconds()
	if ms < 0 {
		ms = 0
	}
	if err := c.runScriptStatus(ctx, "moveToDelayed", []string{
		c.keys.Marker(), c.keys.Active(), c.keys.Prioritized(), c.keys.Delayed(),
		c.keys.Job(j.ID), c.keys.Events(), c.keys.Meta(), c.keys.Stalled(),
		c.keys.Wait(), c.keys.Limiter(), c.keys.Paused(), c.keys.PC(),
	},
		c.keys.KeyPrefix(), nowMillis(), j.ID, token, ms,
		boolToStr(skipAttempt),
		"",  // no extra fields to update
		"0", // do not fetch the next job
		"",  // unused when not fetching
	); err != nil {
		return err
	}
	j.Delay = ms
	return nil
}

// MoveToWaitingChildren parks an active parent job until its children finish.
// It returns true when the job was moved and false when there were no pending
// dependencies. Processors should return [ErrWaitingChildren] when true.
func (j *Job) MoveToWaitingChildren(ctx context.Context, childJobID string) (bool, error) {
	c, err := j.ctx()
	if err != nil {
		return false, err
	}
	token := j.token
	if token == "" {
		token = "0"
	}
	childKey := ""
	if childJobID != "" {
		childKey = c.keys.Job(childJobID)
	}
	res, err := c.runScript(ctx, "moveToWaitingChildren", []string{
		c.keys.Active(), c.keys.WaitingChildren(), c.keys.Job(j.ID),
		c.keys.Dependencies(j.ID), c.keys.Job(j.ID) + ":unsuccessful",
		c.keys.Stalled(), c.keys.Events(),
	}, token, childKey, nowMillis(), j.ID, c.keys.KeyPrefix())
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

func nowMillis() int64 {
	return time.Now().UnixMilli()
}
