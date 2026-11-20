package bullmq_test

import (
	"context"
	"strings"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
	"github.com/taskforcesh/bullmq-go/internal/testbackends"
)

// testBackend is one datastore of the behaviour test matrix.
type testBackend = testbackends.Backend

// forEachBackend runs fn as a subtest against every datastore available to
// this test run (see testbackends.All), skipping unreachable ones.
func forEachBackend(t *testing.T, fn func(t *testing.T, be testBackend)) {
	t.Helper()
	for _, be := range testbackends.All() {
		t.Run(be.Name, func(t *testing.T) {
			be.Require(t)
			fn(t, be)
		})
	}
}

// testQueueName returns a queue name unique to the running test.
func testQueueName(t *testing.T) string {
	t.Helper()
	name := strings.NewReplacer("/", "-", " ", "-", ":", "-").Replace(t.Name())
	return "go-test-" + name + "-" + time.Now().Format("150405.000000")
}

// newTestQueue creates a queue on be that is obliterated when the test ends.
func newTestQueue(t *testing.T, be testBackend, opts *bullmq.QueueOptions) *bullmq.Queue {
	t.Helper()
	return newNamedTestQueue(t, be, testQueueName(t), opts)
}

// newNamedTestQueue creates the queue name on be, which is obliterated when
// the test ends.
func newNamedTestQueue(t *testing.T, be testBackend, name string, opts *bullmq.QueueOptions) *bullmq.Queue {
	t.Helper()
	if opts == nil {
		opts = &bullmq.QueueOptions{}
	}
	if opts.Backend == nil {
		opts.Backend = be.Factory
	}
	q, err := bullmq.NewQueue(name, opts)
	if err != nil {
		t.Fatalf("NewQueue: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = q.Obliterate(ctx, true, 1000)
		_ = q.Close()
	})
	return q
}

// newTestWorker creates a worker on be for queueName. Start it with
// runWorker, which also stops it when the test ends.
func newTestWorker(t *testing.T, be testBackend, queueName string, proc bullmq.Processor, opts *bullmq.WorkerOptions) *bullmq.Worker {
	t.Helper()
	if opts == nil {
		opts = &bullmq.WorkerOptions{}
	}
	if opts.Backend == nil {
		opts.Backend = be.Factory
	}
	if opts.DrainDelay == 0 {
		opts.DrainDelay = 200 * time.Millisecond
	}
	if opts.StalledInterval == 0 {
		opts.StalledInterval = 2 * time.Second
	}
	w, err := bullmq.NewWorker(queueName, proc, opts)
	if err != nil {
		t.Fatalf("NewWorker: %v", err)
	}
	return w
}

// runWorker starts w in the background and stops it when the test ends.
func runWorker(t *testing.T, w *bullmq.Worker) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		_ = w.Run(ctx)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-stopped:
		case <-time.After(10 * time.Second):
			t.Error("worker did not stop in time")
		}
		_ = w.Close()
	})
}

// waitFor polls cond until it returns true or the timeout elapses.
func waitFor(t *testing.T, timeout time.Duration, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out after %s waiting for %s", timeout, what)
}

func testContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	return ctx
}
