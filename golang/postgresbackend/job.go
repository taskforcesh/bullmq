package postgresbackend

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// GetJob returns the stored job, or nil when it does not exist.
func (b *Backend) GetJob(ctx context.Context, jobID string) (*bullmq.JobRecord, error) {
	jobs, err := b.queryJobs(ctx, "get_job_data", b.name, jobID)
	if err != nil || len(jobs) == 0 {
		return nil, err
	}
	return jobs[0], nil
}

// GetState returns the state of a job, or StateUnknown. Prioritized is not
// a stored state on PostgreSQL: it is a waiting job with a priority.
func (b *Backend) GetState(ctx context.Context, jobID string) (bullmq.JobState, error) {
	var (
		state    string
		priority int64
	)
	err := b.queryRow(ctx, "get_state", []any{b.name, jobID}, &state, &priority)
	if isNoRows(err) {
		return bullmq.StateUnknown, nil
	}
	if err != nil {
		return bullmq.StateUnknown, err
	}
	if state == string(bullmq.StateWaiting) && priority > 0 {
		return bullmq.StatePrioritized, nil
	}
	return bullmq.JobState(state), nil
}

// UpdateData replaces the job payload.
func (b *Backend) UpdateData(ctx context.Context, jobID string, data []byte) error {
	payload := string(data)
	if payload == "" {
		payload = "null"
	}
	var id string
	err := b.queryRow(ctx, "update_data", []any{b.name, jobID, payload}, &id)
	if isNoRows(err) {
		return codeError("updateData", bullmq.ErrCodeJobNotExist)
	}
	return err
}

// UpdateProgress stores a new progress value and emits the progress event.
func (b *Backend) UpdateProgress(ctx context.Context, jobID string, progress bullmq.Progress) error {
	var updated int64
	if err := b.queryRow(ctx, "update_progress", []any{b.name, jobID, progress.Raw()}, &updated); err != nil {
		return err
	}
	if updated == 0 {
		return codeError("updateProgress", bullmq.ErrCodeJobNotExist)
	}
	return nil
}

// AddLog appends a row to the job log, keeping at most keepLogs rows when it
// is positive, and returns the number of rows.
func (b *Backend) AddLog(ctx context.Context, jobID, row string, keepLogs int64) (int64, error) {
	var idx int64
	err := b.queryRow(ctx, "add_log", []any{b.name, jobID, row}, &idx)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" { // foreign_key_violation: no such job
		return 0, codeError("addLog", bullmq.ErrCodeJobNotExist)
	}
	if err != nil {
		return 0, err
	}
	count := idx + 1
	if keepLogs > 0 && count > keepLogs {
		if err := b.exec(ctx, "trim_logs", b.name, jobID, count-keepLogs); err != nil {
			return 0, err
		}
		return keepLogs, nil
	}
	return count, nil
}

// GetJobLogs returns the log rows in [start, end], with the semantics of
// Redis LRANGE, together with the total number of rows.
func (b *Backend) GetJobLogs(ctx context.Context, jobID string, start, end int64) ([]string, int64, error) {
	var count int64
	if err := b.queryRow(ctx, "get_job_logs_count", []any{b.name, jobID}, &count); err != nil {
		return nil, 0, err
	}
	from := start
	if from < 0 {
		from = max(count+start, 0)
	}
	to := end
	if to < 0 {
		to = count + end
	}
	if to-from+1 <= 0 {
		return []string{}, count, nil
	}
	rows, err := b.queryStrings(ctx, "get_job_logs_asc", b.name, jobID, from, to-from+1)
	return rows, count, err
}

// ChangeDelay changes the delay of a delayed job.
func (b *Backend) ChangeDelay(ctx context.Context, jobID string, delay time.Duration) error {
	return b.codeCommand(ctx, "change_delay", "changeDelay", b.name, jobID, delay.Milliseconds(), nowMillis())
}

// ChangePriority changes the priority and lifo flag of a waiting job.
func (b *Backend) ChangePriority(ctx context.Context, jobID string, priority int64, lifo bool) error {
	return b.codeCommand(ctx, "change_priority", "changePriority", b.name, jobID, clampInt32(priority), lifo)
}

// Promote moves a delayed job to the wait list.
func (b *Backend) Promote(ctx context.Context, jobID string) error {
	return b.codeCommand(ctx, "promote", "promote", b.name, jobID)
}

// RetryFinishedJob moves a completed or failed job back to the wait list.
func (b *Backend) RetryFinishedJob(ctx context.Context, jobID string, state bullmq.JobState, lifo bool, opts bullmq.RetryOptions) error {
	var code int64
	if err := b.queryRow(ctx, "reprocess_job",
		[]any{b.name, jobID, string(state), lifo, opts.ResetAttemptsMade, opts.ResetAttemptsStarted}, &code); err != nil {
		return err
	}
	if code != 1 {
		return codeError("reprocessJob", code)
	}
	return nil
}

// Remove deletes the job and optionally its children. It returns false when
// the job, or one of the children to remove, is locked by a worker.
func (b *Backend) Remove(ctx context.Context, jobID string, removeChildren bool) (bool, error) {
	var n int64
	if err := b.queryRow(ctx, "remove", []any{b.name, jobID, removeChildren}, &n); err != nil {
		return false, err
	}
	if n > 0 {
		return true, nil
	}
	// The command also reports 0 for a job that does not exist, which, as on
	// Redis, counts as removed.
	state, err := b.GetState(ctx, jobID)
	if err != nil {
		return false, err
	}
	return state == bullmq.StateUnknown, nil
}

// codeCommand runs a command that returns a status code, negative on error.
func (b *Backend) codeCommand(ctx context.Context, cmd, script string, args ...any) error {
	var code int64
	if err := b.queryRow(ctx, cmd, args, &code); err != nil {
		return err
	}
	if code < 0 {
		return codeError(script, code)
	}
	return nil
}
