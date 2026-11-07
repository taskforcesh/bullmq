package bullmq

import (
	"context"
	"errors"
	"testing"
	"time"
)

// A callback that closes the worker must not deadlock with Run, which holds
// runOnce for its whole lifetime and waits for the goroutines emitting errors.
func TestOnErrorCanCloseWorker(t *testing.T) {
	var w *Worker
	closed := make(chan error, 1)
	w, err := NewWorker("onerror-close", func(context.Context, *Job) (any, error) { return nil, nil },
		&WorkerOptions{
			OnError: func(error) { closed <- w.Close() },
		})
	if err != nil {
		t.Fatalf("NewWorker: %v", err)
	}

	// Emulate Run: emit an error while runOnce is held, and return without
	// waiting for the callback.
	w.runOnce.Do(func() {
		w.emitError(errors.New("boom"))
	})

	select {
	case <-closed:
	case <-time.After(5 * time.Second):
		t.Fatal("Close called from OnError deadlocked")
	}
}
