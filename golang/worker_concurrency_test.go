package bullmq_test

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// SetConcurrency changes a running worker's concurrency, as setting Node's
// worker.concurrency does: raising it fetches jobs for the new slots at
// once, lowering it lets the jobs in flight finish and then keeps to the
// new limit.
func TestWorkerSetConcurrency(t *testing.T) {
	forEachBackend(t, testWorkerSetConcurrency)
}

func testWorkerSetConcurrency(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	gate := make(chan struct{})
	var running, peak, completed atomic.Int32
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		n := running.Add(1)
		defer running.Add(-1)
		for {
			p := peak.Load()
			if n <= p || peak.CompareAndSwap(p, n) {
				break
			}
		}
		select {
		case <-gate:
			return nil, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}, &bullmq.WorkerOptions{
		Concurrency: 1,
		OnEvent: func(ev bullmq.Event) {
			if ev.Type == bullmq.EventCompleted {
				completed.Add(1)
			}
		},
	})
	var cfgErr *bullmq.ConfigError
	if err := w.SetConcurrency(0); !errors.As(err, &cfgErr) {
		t.Errorf("SetConcurrency(0) = %v, want a ConfigError", err)
	}
	if n := w.Concurrency(); n != 1 {
		t.Errorf("Concurrency() = %d, want 1", n)
	}
	addJobs(t, ctx, q, 6)
	runWorker(t, w)
	waitFor(t, 10*time.Second, "one job in flight", func() bool { return running.Load() == 1 })

	if err := w.SetConcurrency(3); err != nil {
		t.Fatalf("SetConcurrency(3): %v", err)
	}
	waitFor(t, 3*time.Second, "three jobs in flight", func() bool { return running.Load() == 3 })
	if n := w.Concurrency(); n != 3 {
		t.Errorf("Concurrency() = %d, want 3", n)
	}

	// Lowered while three jobs run: they all finish, and the next ones run
	// one at a time.
	if err := w.SetConcurrency(1); err != nil {
		t.Fatalf("SetConcurrency(1): %v", err)
	}
	for range 3 {
		gate <- struct{}{}
	}
	waitFor(t, 10*time.Second, "the three jobs to complete", func() bool { return completed.Load() == 3 })
	waitFor(t, 10*time.Second, "the next job", func() bool { return running.Load() == 1 })
	peak.Store(running.Load())
	time.Sleep(300 * time.Millisecond)
	for range 3 {
		gate <- struct{}{}
	}
	waitFor(t, 10*time.Second, "every job to complete", func() bool { return completed.Load() == 6 })
	if p := peak.Load(); p != 1 {
		t.Errorf("%d jobs ran at once after SetConcurrency(1), want 1", p)
	}
}
