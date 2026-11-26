package bullmq

import (
	"errors"
	"io"
)

// stubBackend is a Backend for unit tests that never reach a datastore. The
// methods it does not override panic through the nil embedded interface.
type stubBackend struct {
	Backend
}

func (stubBackend) Close() error { return nil }

func (stubBackend) QueueName() string { return "stub" }

func (stubBackend) IsTransientError(err error) bool { return errors.Is(err, io.EOF) }

func stubBackendFactory(string, BackendOptions) (Backend, error) { return stubBackend{}, nil }
