package bullmq

import (
	"context"
	"encoding/json"
)

// MoveToWait puts the active job back in the wait list (or the prioritized
// set, keeping its priority) without counting an attempt, and releases its
// lock, as Node's job.moveToWait does. A processor must then return
// [ErrWaiting], so the worker does not also finish the job. It fails when
// the job's lock is gone or held by another token.
func (j *Job) MoveToWait(ctx context.Context) error {
	b, err := j.ctx()
	if err != nil {
		return err
	}
	_, err = b.MoveJobFromActiveToWait(ctx, j.ID, j.token)
	return err
}

// MoveToCompleted completes a job fetched with Worker.GetNextJob and locked
// with token, recording result (encoded as JSON) as its return value, as
// Node's job.moveToCompleted does. The worker's settings apply: the removal
// policy, the metrics and, for the next job, the lock duration and limiter.
//
// With fetchNext, the next job is fetched in the same datastore call and
// locked with the same token, as GetNextJob(ctx, token, false) would; it is
// returned, or nil when there is none (or the worker is paused or closed).
// It fails when the job's lock is gone or held by another token, for
// example because the job stalled.
//
// Processors don't call it: the worker completes their jobs.
func (j *Job) MoveToCompleted(ctx context.Context, result any, token string, fetchNext bool) (*Job, error) {
	w, err := j.manualWorker(token)
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	j.token = token
	res, err := w.moveToCompleted(ctx, j, raw, fetchNext && w.canFetchNext(ctx))
	if err != nil {
		return nil, err
	}
	return w.manualNext(ctx, res.Next, token), nil
}

// MoveToFailed records a failed attempt of a job fetched with
// Worker.GetNextJob and locked with token, with cause as its failure, as
// Node's job.moveToFailed does. As when a processor fails, the job is
// retried, after its backoff, while attempts remain, unless cause is
// unrecoverable (see [NewUnrecoverableError]) or the job was discarded;
// otherwise it fails for good.
//
// With fetchNext, the next job is fetched in the same datastore call, as in
// MoveToCompleted, and returned. A job retried right away is not, so
// fetch it with GetNextJob. It fails when the job's lock is gone or held by
// another token.
func (j *Job) MoveToFailed(ctx context.Context, cause error, token string, fetchNext bool) (*Job, error) {
	if cause == nil {
		return nil, configError("MoveToFailed needs the error the job failed with")
	}
	w, err := j.manualWorker(token)
	if err != nil {
		return nil, err
	}
	j.token = token
	next, err := w.moveToFailed(ctx, j, cause, fetchNext && w.canFetchNext(ctx))
	if err != nil {
		return nil, err
	}
	if next.delayed && (next.res == nil || next.res.Job == nil) {
		// The delayed transition doesn't say why it fetched no job.
		return nil, nil
	}
	return w.manualNext(ctx, next.res, token), nil
}

// manualWorker returns the worker that fetched the job, whose settings
// finish it.
func (j *Job) manualWorker(token string) (*Worker, error) {
	if _, err := j.ctx(); err != nil {
		return nil, err
	}
	if j.worker == nil {
		return nil, configError("job %s was not fetched by a Worker: fetch it with Worker.GetNextJob to finish it by hand", j.ID)
	}
	if token == "" {
		return nil, configError("finishing job %s needs the token it was fetched with", j.ID)
	}
	return j.worker, nil
}
