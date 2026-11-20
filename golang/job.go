package bullmq

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// ParentKeys identifies the parent of a job as persisted by the backend.
type ParentKeys struct {
	// ID is the parent job id.
	ID string `json:"id"`
	// QueueKey is the qualified name of the parent's queue (see
	// [Backend.QualifiedName]): `{prefix}:{queueName}` on Redis, the bare
	// queue name on PostgreSQL.
	QueueKey string `json:"queueKey"`
}

// Job is a unit of work stored in a queue.
//
// Values returned by Queue and Worker methods carry a live [Backend], so
// mutating methods such as UpdateProgress or Log can be called on them.
type Job struct {
	// ID is the job id.
	ID string
	// Name is the job name.
	Name string
	// Data is the JSON encoded payload. On PostgreSQL, which stores it as
	// jsonb, a job read back from the datastore holds an equal JSON value
	// but not necessarily the same bytes (whitespace and key order may
	// differ), so decode it rather than compare bytes.
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
	// DeferredFailure is set by the stalled-check script when the job
	// exceeded MaxStalledCount; when non-empty the job must be failed
	// unrecoverably instead of being handed to the processor.
	DeferredFailure string
	// Stacktrace holds the recorded failure traces.
	Stacktrace []string
	// ReturnValue is the JSON encoded value returned by the processor. On
	// PostgreSQL it is re-encoded as Data is: equal as JSON, possibly with
	// different bytes.
	ReturnValue json.RawMessage
	// ParentKey is the key of the parent job, if any.
	ParentKey string
	// Parent identifies the parent job, if any.
	Parent *ParentKeys
	// ProcessedBy is the name of the worker that last processed the job.
	ProcessedBy string
	// StalledCounter is how many times the job has been detected as stalled.
	StalledCounter int64
	// Delay is the configured delay, in milliseconds (ChangeDelay takes a
	// time.Duration).
	Delay int64
	// Priority is the configured priority.
	Priority int64
	// RepeatJobKey links the job to a job scheduler.
	RepeatJobKey string
	// DeduplicationID is the deduplication id the job was added with (see
	// JobOptions.Deduplication), or "".
	DeduplicationID string
	// QueueName is the name of the owning queue.
	QueueName string

	backend      Backend
	worker       *Worker
	token        string
	lockDuration time.Duration
	discarded    bool
}

// newJob builds a Job bound to backend from the record it returned.
func newJob(b Backend, rec *JobRecord) *Job {
	job := &Job{
		ID:              rec.ID,
		Name:            rec.Name,
		Data:            rec.Data,
		Opts:            rec.Opts,
		Progress:        rec.Progress,
		AttemptsMade:    rec.AttemptsMade,
		AttemptsStarted: rec.AttemptsStarted,
		Timestamp:       rec.Timestamp,
		ProcessedOn:     rec.ProcessedOn,
		FinishedOn:      rec.FinishedOn,
		FailedReason:    rec.FailedReason,
		DeferredFailure: rec.DeferredFailure,
		Stacktrace:      rec.Stacktrace,
		ReturnValue:     rec.ReturnValue,
		ParentKey:       rec.ParentKey,
		Parent:          rec.Parent,
		ProcessedBy:     rec.ProcessedBy,
		StalledCounter:  rec.StalledCounter,
		Delay:           rec.Delay,
		Priority:        rec.Priority,
		RepeatJobKey:    rec.RepeatJobKey,
		DeduplicationID: rec.DeduplicationID,
		QueueName:       b.QueueName(),
		backend:         b,
	}
	if job.DeduplicationID == "" {
		job.DeduplicationID = rec.Opts.deduplicationID()
	}
	return job
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

func (j *Job) ctx() (Backend, error) {
	if j.backend == nil {
		return nil, ErrNoContext
	}
	return j.backend, nil
}

// UpdateProgress stores a new progress value and emits a `progress` event on
// the owning Worker, mirroring how a per-job update is observed through
// Worker.Events.
//
// progress is a number, or any value encoded as JSON, as Node's
// updateProgress takes a number or an object; a [Progress] is stored as
// is. NaN and infinite numbers, which have no JSON encoding, are rejected.
func (j *Job) UpdateProgress(ctx context.Context, progress any) error {
	p, err := progressOf(progress)
	if err != nil {
		return err
	}
	b, err := j.ctx()
	if err != nil {
		return err
	}
	if err := b.UpdateProgress(ctx, j.ID, p); err != nil {
		return err
	}
	j.Progress = p
	// worker is set before the job is handed to the processor and never
	// changes, so goroutines that outlive the processor may read it; emit
	// discards events once the worker is closed.
	if j.worker != nil {
		j.worker.emit(Event{Type: EventProgress, Job: j, Result: p})
	}
	return nil
}

// UpdateData replaces the job payload.
func (j *Job) UpdateData(ctx context.Context, data any) error {
	b, err := j.ctx()
	if err != nil {
		return err
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	if err := b.UpdateData(ctx, j.ID, raw); err != nil {
		return err
	}
	j.Data = raw
	return nil
}

// Log appends a row to the job log and returns the total number of rows kept.
func (j *Job) Log(ctx context.Context, message string) (int64, error) {
	b, err := j.ctx()
	if err != nil {
		return 0, err
	}
	var keepLogs int64
	if j.Opts != nil {
		keepLogs = j.Opts.keepLogsVal()
	}
	return b.AddLog(ctx, j.ID, message, keepLogs)
}

// Logs returns the log rows of the job together with the total count.
func (j *Job) Logs(ctx context.Context, start, end int64) ([]string, int64, error) {
	b, err := j.ctx()
	if err != nil {
		return nil, 0, err
	}
	return b.GetJobLogs(ctx, j.ID, start, end)
}

// State returns the current state of the job.
func (j *Job) State(ctx context.Context) (JobState, error) {
	b, err := j.ctx()
	if err != nil {
		return StateUnknown, err
	}
	return b.GetState(ctx, j.ID)
}

// Remove deletes the job and all of its data. Active jobs cannot be removed.
func (j *Job) Remove(ctx context.Context, removeChildren bool) error {
	b, err := j.ctx()
	if err != nil {
		return err
	}
	removed, err := b.Remove(ctx, j.ID, removeChildren)
	if err != nil {
		return err
	}
	if !removed {
		return fmt.Errorf("bullmq: job %s could not be removed because it is locked by another worker: %w", j.ID, ErrJobLocked)
	}
	return nil
}

// RemoveDeduplicationKey releases the job's deduplication id if the job
// still holds it, so the next job added with it is not deduplicated, as
// Node's job.removeDeduplicationKey does. It reports whether it did: false
// when the job has no deduplication id, or when the id expired or is held
// by another job.
func (j *Job) RemoveDeduplicationKey(ctx context.Context) (bool, error) {
	b, err := j.ctx()
	if err != nil {
		return false, err
	}
	if j.DeduplicationID == "" {
		return false, nil
	}
	return b.RemoveDeduplicationKey(ctx, j.DeduplicationID, j.ID)
}

// Promote moves a delayed job to the wait list immediately.
func (j *Job) Promote(ctx context.Context) error {
	b, err := j.ctx()
	if err != nil {
		return err
	}
	if err := b.Promote(ctx, j.ID); err != nil {
		return err
	}
	j.Delay = 0
	return nil
}

// ChangeDelay makes a job that is in the delayed set due after delay,
// counted from now. delay is a time.Duration, used with millisecond
// precision, unlike JobOptions.Delay and Job.Delay, which are milliseconds:
// pass 4*time.Second, not 4000.
func (j *Job) ChangeDelay(ctx context.Context, delay time.Duration) error {
	b, err := j.ctx()
	if err != nil {
		return err
	}
	if err := b.ChangeDelay(ctx, j.ID, delay); err != nil {
		return err
	}
	j.Delay = delay.Milliseconds()
	return nil
}

// ChangePriority updates the priority of a waiting or prioritized job.
func (j *Job) ChangePriority(ctx context.Context, priority int64, lifo bool) error {
	if priority < 0 || priority > priorityLimit {
		return configError("priority should be between 0 and %d", priorityLimit)
	}
	b, err := j.ctx()
	if err != nil {
		return err
	}
	if err := b.ChangePriority(ctx, j.ID, priority, lifo); err != nil {
		return err
	}
	j.Priority = priority
	return nil
}

// RetryOptions tunes [Job.Retry], as Node's RetryOptions does.
type RetryOptions struct {
	// ResetAttemptsMade sets the job's attempts-made counter back to 0, so
	// it gets every attempt of JobOptions.Attempts again.
	ResetAttemptsMade bool
	// ResetAttemptsStarted sets the job's attempts-started counter back to
	// 0, which WorkerOptions.MaxStartedAttempts checks.
	ResetAttemptsStarted bool
}

// Retry moves a completed or failed job back to the wait list (or to the
// prioritized set when it has a priority). opts may be nil.
//
// state must be either StateCompleted or StateFailed. Unless opts resets
// them, the attempt counters are kept: a job that used up its attempts
// fails for good after its next failure.
func (j *Job) Retry(ctx context.Context, state JobState, opts *RetryOptions) error {
	b, err := j.ctx()
	if err != nil {
		return err
	}
	if state != StateCompleted && state != StateFailed {
		return configError("retry state must be %q or %q", StateCompleted, StateFailed)
	}
	var o RetryOptions
	if opts != nil {
		o = *opts
	}
	if err := b.RetryFinishedJob(ctx, j.ID, state, j.Opts.isLIFO(), o); err != nil {
		return err
	}
	j.FailedReason = ""
	j.FinishedOn = 0
	j.ProcessedOn = 0
	j.ReturnValue = nil
	if o.ResetAttemptsMade {
		j.AttemptsMade = 0
	}
	if o.ResetAttemptsStarted {
		j.AttemptsStarted = 0
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

// ExtendLock refreshes the lock held on an active job, so it expires
// duration (a time.Duration, used with millisecond precision) from now.
func (j *Job) ExtendLock(ctx context.Context, duration time.Duration) error {
	b, err := j.ctx()
	if err != nil {
		return err
	}
	if j.token == "" {
		return ErrJobLockNotExist
	}
	return b.ExtendLock(ctx, j.ID, j.token, duration)
}

// MoveToDelayed reschedules an active job to run after delay, a
// time.Duration counted from now and used with millisecond precision (Node's
// moveToDelayed takes the due timestamp instead). Processors should return
// [ErrDelayed] afterwards so the worker does not also move the job to a
// finished state.
//
// The current attempt is not counted, matching the Node.js implementation.
func (j *Job) MoveToDelayed(ctx context.Context, delay time.Duration) error {
	return j.moveToDelayed(ctx, delay, true, nil)
}

// moveToDelayed reschedules an active job. When skipAttempt is false the
// attemptsMade counter is incremented, which is what the worker needs when it
// retries a failed job with a backoff.
func (j *Job) moveToDelayed(ctx context.Context, delay time.Duration, skipAttempt bool, failure *FailureInfo) error {
	b, err := j.ctx()
	if err != nil {
		return err
	}
	if j.token == "" {
		return ErrJobLockNotExist
	}
	if _, err := b.MoveToDelayed(ctx, j.ID, j.token, delay, MoveToDelayedOptions{
		SkipAttempt: skipAttempt,
		Failure:     failure,
	}); err != nil {
		return err
	}
	j.Delay = max(delay.Milliseconds(), 0)
	return nil
}

// MoveToWaitingChildren parks an active parent job until its children finish.
// It returns true when the job was moved and false when there were no pending
// dependencies. Processors should return [ErrWaitingChildren] when true.
//
// child identifies the job whose completion is being awaited. Its QueueKey
// must be the fully qualified queue name (see [Backend.QualifiedName]) of the
// queue the child belongs to, which may differ from the parent's own queue.
// Pass nil if there is no specific child to check for.
func (j *Job) MoveToWaitingChildren(ctx context.Context, child *ParentKeys) (bool, error) {
	b, err := j.ctx()
	if err != nil {
		return false, err
	}
	return b.MoveToWaitingChildren(ctx, j.ID, j.token, child)
}
