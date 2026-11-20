package bullmq

import "context"

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
