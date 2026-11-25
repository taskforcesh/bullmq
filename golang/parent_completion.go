package bullmq

import (
	"errors"
	"fmt"
)

// childrenError is the failure of a job the datastore refused to complete
// because of its children. Its message is Node's, so the stored failed
// reason is the same whichever runtime processed the job.
type childrenError struct {
	msg string
	err error
}

func (e *childrenError) Error() string { return e.msg }

func (e *childrenError) Unwrap() error { return e.err }

// completionBlockedByChildren returns the error a job fails with when
// completing it failed with err because it still has pending children or
// because a child failed it, or nil for any other error. As in Node, such a
// job is failed rather than left active.
func completionBlockedByChildren(jobID string, err error) error {
	switch {
	case errors.Is(err, ErrJobPendingDependencies):
		return &childrenError{msg: fmt.Sprintf("Job %s has pending dependencies. moveToFinished", jobID), err: err}
	case errors.Is(err, ErrJobHasFailedChildren):
		return &childrenError{msg: fmt.Sprintf("Cannot complete job %s because it has at least one failed child. moveToFinished", jobID), err: err}
	default:
		return nil
	}
}
