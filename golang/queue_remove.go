package bullmq

import "context"

// Remove deletes the job jobID and all of its data, as Node's queue.remove
// does, without reading it first. With removeChildren, its children are
// removed too, recursively. It returns false, removing nothing, when the job
// or one of the children to remove is locked by a worker (Job.Remove reports
// that as [ErrJobLocked]); a job that does not exist counts as removed. The
// current job of a job scheduler can't be removed this way
// ([ErrJobBelongsToJobScheduler]); remove the scheduler instead.
func (q *Queue) Remove(ctx context.Context, jobID string, removeChildren bool) (bool, error) {
	return q.backend.Remove(ctx, jobID, removeChildren)
}
