package bullmq

import (
	"context"
	"errors"
	"testing"
	"time"
)

// A callback that closes the worker must not deadlock with Run, which waits
// for the goroutines emitting errors before it returns, while Close waits
// for Run to return.
func TestOnErrorCanCloseWorker(t *testing.T) {
	var w *Worker
	closed := make(chan error, 1)
	w, err := NewWorker("onerror-close", func(context.Context, *Job) (any, error) { return nil, nil },
		&WorkerOptions{
			Backend: stubBackendFactory,
			OnError: func(error) { closed <- w.Close() },
		})
	if err != nil {
		t.Fatalf("NewWorker: %v", err)
	}

	// Emulate Run: claim startup, emit an error, and return (closing runDone)
	// without waiting for the callback.
	w.runOnce.Do(func() {})
	w.emitError(errors.New("boom"))
	close(w.runDone)

	select {
	case <-closed:
	case <-time.After(5 * time.Second):
		t.Fatal("Close called from OnError deadlocked")
	}
}
