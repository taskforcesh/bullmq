package bullmq

import (
	"errors"
	"fmt"
)

// Error codes returned by the shared Lua commands, and by the shared SQL
// commands on PostgreSQL (see [ScriptError]).
const (
	ErrCodeJobNotExist          = -1
	ErrCodeJobLockNotExist      = -2
	ErrCodeJobNotInState        = -3
	ErrCodeJobPendingDeps       = -4
	ErrCodeParentJobNotExist    = -5
	ErrCodeJobLockMismatch      = -6
	ErrCodeJobHasFailedChildren = -9
)

// ErrCodeParentJobCannotBeReplaced is the script error code returned when a
// job that already belongs to a parent is added under another one.
const ErrCodeParentJobCannotBeReplaced = -7

// Script error codes of job schedulers.
const (
	ErrCodeJobBelongsToJobScheduler = -8
	ErrCodeSchedulerJobIDCollision  = -10
	ErrCodeSchedulerJobSlotsBusy    = -11
)

// Sentinel errors returned by the library.
var (
	// ErrJobNotFound is returned when the job an operation refers to does
	// not exist (any longer) in the datastore.
	ErrJobNotFound = errors.New("bullmq: missing job key")
	// ErrJobLockNotExist is returned when the job lock is missing.
	ErrJobLockNotExist = errors.New("bullmq: missing job lock")
	// ErrJobNotInState is returned when a job is not in the expected state set.
	ErrJobNotInState = errors.New("bullmq: job is not in the expected state")
	// ErrJobPendingDependencies is returned when a parent still has pending children.
	ErrJobPendingDependencies = errors.New("bullmq: job has pending dependencies")
	// ErrParentJobNotExist is returned when the referenced parent job is missing.
	ErrParentJobNotExist = errors.New("bullmq: parent job does not exist")
	// ErrJobLockMismatch is returned when the lock is owned by another client.
	ErrJobLockMismatch = errors.New("bullmq: lock is not owned by this client")
	// ErrParentJobCannotBeReplaced is returned when a job that already
	// belongs to a parent is added again under another one.
	ErrParentJobCannotBeReplaced = errors.New("bullmq: the parent of a job cannot be replaced")
	// ErrJobHasFailedChildren is returned when a parent cannot complete because a child failed.
	ErrJobHasFailedChildren = errors.New("bullmq: job has failed children")
	// ErrJobBelongsToJobScheduler is returned when removing the pending job
	// of a job scheduler, which only RemoveJobScheduler may remove.
	ErrJobBelongsToJobScheduler = errors.New("bullmq: job belongs to a job scheduler and cannot be removed directly")
	// ErrSchedulerJobIDCollision is returned when the job of a scheduler's
	// next iteration already exists.
	ErrSchedulerJobIDCollision = errors.New("bullmq: cannot create job scheduler iteration, job id already exists")
	// ErrSchedulerJobSlotsBusy is returned when the jobs of the next
	// iterations of an Every scheduler already exist.
	ErrSchedulerJobSlotsBusy = errors.New("bullmq: cannot create job scheduler iteration, current and next time slots already have jobs")
	// ErrJobLocked is returned by Job.Remove when the job (or a dependency) is
	// currently locked by another worker and therefore cannot be removed.
	ErrJobLocked = errors.New("bullmq: job is locked by another worker")

	// ErrWorkerClosed is returned by Worker.Run when the worker was already
	// run or is closed, and by Worker.Pause when the worker is closed while
	// Pause waits for its jobs.
	ErrWorkerClosed = errors.New("bullmq: worker is closed")
	// ErrQueueEventsClosed is returned by QueueEvents.Run when it was
	// already called or the listener is closed.
	ErrQueueEventsClosed = errors.New("bullmq: queue events is closed")
	// ErrNoContext is returned by the methods of a Job that reach the
	// datastore, such as UpdateProgress or Log, when the Job has no backend:
	// it was built by the caller (for example in a unit test) rather than
	// returned by a Queue, a Worker or a FlowProducer.
	ErrNoContext = errors.New("bullmq: job has no backend")
	// ErrDelayed is returned by a processor that has moved its job to the delayed set.
	ErrDelayed = errors.New("bullmq: job moved to delayed")
	// ErrWaitingChildren is returned by a processor that moved its job to waiting-children.
	ErrWaitingChildren = errors.New("bullmq: job moved to waiting children")
	// ErrWaiting is returned by a processor that moved its job back to wait
	// with Job.MoveToWait, as Node's WaitingError.
	ErrWaiting = errors.New("bullmq: job moved to wait")

	// ErrRateLimited is returned by a processor to put its job back in the
	// wait list without using up an attempt, because the queue is rate
	// limited (see Worker.RateLimit), as Node's Worker.RateLimitError does.
	// The worker then waits until the rate limit lifts.
	ErrRateLimited = errors.New("bullmq: rate limit exceeded")

	// ErrJobCancelled is the cause (see context.Cause) of the context of a
	// job cancelled with Worker.CancelJob or Worker.CancelAllJobs. The cause
	// reads as the cancellation reason and matches ErrJobCancelled with
	// errors.Is.
	ErrJobCancelled = errors.New("bullmq: job cancelled")
	// ErrLockLost is the cause (see context.Cause) of the context of a job
	// whose lock the worker could not renew: the job may belong to another
	// worker now.
	ErrLockLost = errors.New("bullmq: job lock lost")
)

// cancelledError is the cause of a job context cancelled by Worker.CancelJob.
type cancelledError struct{ reason string }

func (e *cancelledError) Error() string {
	if e.reason == "" {
		return ErrJobCancelled.Error()
	}
	return e.reason
}

func (e *cancelledError) Is(target error) bool { return target == ErrJobCancelled }

// UnrecoverableError makes a job fail immediately without consuming further attempts.
type UnrecoverableError struct {
	Message string
}

func (e *UnrecoverableError) Error() string { return e.Message }

// NewUnrecoverableError builds an error that stops a job from being retried.
func NewUnrecoverableError(format string, args ...any) error {
	return &UnrecoverableError{Message: fmt.Sprintf(format, args...)}
}

// IsUnrecoverable reports whether err (or any error it wraps) is unrecoverable.
func IsUnrecoverable(err error) bool {
	var target *UnrecoverableError
	return errors.As(err, &target)
}

// ScriptError wraps a negative status code returned by a backend command: a
// Lua command on Redis, or a shared SQL command on PostgreSQL, which raises
// SQLSTATE BM001 with the same code. Script names the command. Code is one
// of the ErrCode constants, and errors.Is matches the corresponding sentinel
// error (for example [ErrJobNotFound] for [ErrCodeJobNotExist]).
type ScriptError struct {
	Code   int64
	Script string
}

func (e *ScriptError) Error() string {
	return fmt.Sprintf("bullmq: script %q returned error code %d", e.Script, e.Code)
}

func (e *ScriptError) Unwrap() error {
	switch e.Code {
	case ErrCodeJobNotExist:
		return ErrJobNotFound
	case ErrCodeJobLockNotExist:
		return ErrJobLockNotExist
	case ErrCodeJobNotInState:
		return ErrJobNotInState
	case ErrCodeJobPendingDeps:
		return ErrJobPendingDependencies
	case ErrCodeParentJobNotExist:
		return ErrParentJobNotExist
	case ErrCodeJobLockMismatch:
		return ErrJobLockMismatch
	case ErrCodeParentJobCannotBeReplaced:
		return ErrParentJobCannotBeReplaced
	case ErrCodeJobHasFailedChildren:
		return ErrJobHasFailedChildren
	case ErrCodeJobBelongsToJobScheduler:
		return ErrJobBelongsToJobScheduler
	case ErrCodeSchedulerJobIDCollision:
		return ErrSchedulerJobIDCollision
	case ErrCodeSchedulerJobSlotsBusy:
		return ErrSchedulerJobSlotsBusy
	default:
		return nil
	}
}

func scriptError(script string, code int64) error {
	return &ScriptError{Code: code, Script: script}
}

// ConfigError signals invalid user supplied configuration.
type ConfigError struct {
	Message string
}

func (e *ConfigError) Error() string { return "bullmq: " + e.Message }

func configError(format string, args ...any) error {
	return &ConfigError{Message: fmt.Sprintf(format, args...)}
}
