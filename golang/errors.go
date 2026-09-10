package bullmq

import (
	"errors"
	"fmt"
)

// Script error codes returned by the shared Lua commands.
const (
	ErrCodeJobNotExist          = -1
	ErrCodeJobLockNotExist      = -2
	ErrCodeJobNotInState        = -3
	ErrCodeJobPendingDeps       = -4
	ErrCodeParentJobNotExist    = -5
	ErrCodeJobLockMismatch      = -6
	ErrCodeJobHasFailedChildren = -9
)

// Sentinel errors returned by the library.
var (
	// ErrJobNotFound is returned when a job key no longer exists in Redis.
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
	// ErrJobHasFailedChildren is returned when a parent cannot complete because a child failed.
	ErrJobHasFailedChildren = errors.New("bullmq: job has failed children")

	// ErrWorkerClosed is returned when an operation is attempted on a closed worker.
	ErrWorkerClosed = errors.New("bullmq: worker is closed")
	// ErrNoContext is returned when a Job was built without a live Redis context.
	ErrNoContext = errors.New("bullmq: job has no redis context")
	// ErrDelayed is returned by a processor that has moved its job to the delayed set.
	ErrDelayed = errors.New("bullmq: job moved to delayed")
	// ErrWaitingChildren is returned by a processor that moved its job to waiting-children.
	ErrWaitingChildren = errors.New("bullmq: job moved to waiting children")
)

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

// ScriptError wraps a negative status code returned by a Lua command.
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
	case ErrCodeJobHasFailedChildren:
		return ErrJobHasFailedChildren
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
