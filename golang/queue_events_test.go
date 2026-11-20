package bullmq_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// collectEvents starts a QueueEvents listener and returns a snapshot function.
func collectEvents(t *testing.T, be testBackend, queueName string) func() []bullmq.QueueEvent {
	t.Helper()
	qe, err := bullmq.NewQueueEvents(queueName, &bullmq.QueueEventsOptions{
		Backend:         be.Factory,
		BlockingTimeout: 200 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("NewQueueEvents: %v", err)
	}

	var mu sync.Mutex
	var seen []bullmq.QueueEvent

	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		_ = qe.Run(ctx)
	}()
	go func() {
		for ev := range qe.Events() {
			mu.Lock()
			seen = append(seen, ev)
			mu.Unlock()
		}
	}()

	t.Cleanup(func() {
		cancel()
		<-stopped
		_ = qe.Close()
	})

	// Give the listener a moment to subscribe before the caller adds jobs.
	time.Sleep(150 * time.Millisecond)

	return func() []bullmq.QueueEvent {
		mu.Lock()
		defer mu.Unlock()
		return append([]bullmq.QueueEvent(nil), seen...)
	}
}

func hasEvent(events []bullmq.QueueEvent, name, jobID string) bool {
	for _, ev := range events {
		if ev.Event == name && (jobID == "" || ev.JobID == jobID) {
			return true
		}
	}
	return false
}

func TestQueueEventsReportsTheJobLifecycle(t *testing.T) {
	forEachBackend(t, testQueueEventsReportsTheJobLifecycle)
}

func testQueueEventsReportsTheJobLifecycle(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	snapshot := collectEvents(t, be, q.Name())

	w := newTestWorker(t, be, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		return "result", nil
	}, nil)
	runWorker(t, w)

	job, err := q.Add(ctx, "lifecycle", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	waitFor(t, 15*time.Second, "the added, active and completed events", func() bool {
		events := snapshot()
		return hasEvent(events, "added", job.ID) &&
			hasEvent(events, "active", job.ID) &&
			hasEvent(events, "completed", job.ID)
	})

	for _, ev := range snapshot() {
		if ev.Event == "completed" && ev.JobID == job.ID {
			if got := ev.ReturnValue(); got != `"result"` {
				t.Errorf("ReturnValue() = %q, want %q", got, `"result"`)
			}
		}
	}
}

func TestQueueEventsClosesErrorsChannelOnShutdown(t *testing.T) {
	forEachBackend(t, testQueueEventsClosesErrorsChannelOnShutdown)
}

func testQueueEventsClosesErrorsChannelOnShutdown(t *testing.T, be testBackend) {
	q := newTestQueue(t, be, nil)

	drained := func(t *testing.T, qe *bullmq.QueueEvents) {
		t.Helper()
		done := make(chan struct{})
		go func() {
			defer close(done)
			for range qe.Errors() {
			}
		}()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("Errors() was not closed")
		}
	}

	// Closed after Run exits because of cancellation.
	qe, err := bullmq.NewQueueEvents(q.Name(), &bullmq.QueueEventsOptions{
		Backend:         be.Factory,
		BlockingTimeout: 200 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("NewQueueEvents: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	runDone := make(chan struct{})
	go func() {
		defer close(runDone)
		_ = qe.Run(ctx)
	}()
	time.Sleep(100 * time.Millisecond)
	cancel()
	<-runDone
	drained(t, qe)
	_ = qe.Close()

	// Closed by Close when Run was never called.
	unstarted, err := bullmq.NewQueueEvents(q.Name(), &bullmq.QueueEventsOptions{Backend: be.Factory})
	if err != nil {
		t.Fatalf("NewQueueEvents: %v", err)
	}
	_ = unstarted.Close()
	drained(t, unstarted)
}

func TestQueueEventsReportsFailures(t *testing.T) {
	forEachBackend(t, testQueueEventsReportsFailures)
}

func testQueueEventsReportsFailures(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	snapshot := collectEvents(t, be, q.Name())

	w := newTestWorker(t, be, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		return nil, errors.New("kaboom")
	}, nil)
	runWorker(t, w)

	job, err := q.Add(ctx, "explodes", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	waitFor(t, 15*time.Second, "the failed event", func() bool {
		return hasEvent(snapshot(), "failed", job.ID)
	})

	for _, ev := range snapshot() {
		if ev.Event == "failed" && ev.JobID == job.ID {
			if got := ev.FailedReason(); got != "kaboom" {
				t.Errorf("FailedReason() = %q, want %q", got, "kaboom")
			}
		}
	}
}

func TestQueueEventsReportsProgress(t *testing.T) {
	forEachBackend(t, testQueueEventsReportsProgress)
}

func testQueueEventsReportsProgress(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	snapshot := collectEvents(t, be, q.Name())

	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		progress, err := bullmq.NumberProgress(75)
		if err != nil {
			return nil, err
		}
		return nil, job.UpdateProgress(ctx, progress)
	}, nil)
	runWorker(t, w)

	job, err := q.Add(ctx, "reports", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	waitFor(t, 15*time.Second, "the progress event", func() bool {
		return hasEvent(snapshot(), "progress", job.ID)
	})
}

func TestQueueEventsReportsPauseAndResume(t *testing.T) {
	forEachBackend(t, testQueueEventsReportsPauseAndResume)
}

func testQueueEventsReportsPauseAndResume(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	snapshot := collectEvents(t, be, q.Name())

	if err := q.Pause(ctx); err != nil {
		t.Fatalf("Pause: %v", err)
	}
	if err := q.Resume(ctx); err != nil {
		t.Fatalf("Resume: %v", err)
	}

	waitFor(t, 15*time.Second, "the paused and resumed events", func() bool {
		events := snapshot()
		return hasEvent(events, "paused", "") && hasEvent(events, "resumed", "")
	})
}

// stuckReadBackend is a backend whose ReadEvents ignores its context and
// blocks until released, like a driver that cannot interrupt a blocked read.
type stuckReadBackend struct {
	bullmq.Backend
	reading chan struct{}
	release chan struct{}
	closed  chan struct{}
}

func (b *stuckReadBackend) LastEventID(context.Context) (string, error) { return "0-0", nil }

func (b *stuckReadBackend) ReadEvents(context.Context, string, time.Duration) ([]bullmq.QueueEvent, error) {
	select {
	case b.reading <- struct{}{}:
	default:
	}
	<-b.release
	return nil, nil
}

func (b *stuckReadBackend) Close() error {
	close(b.closed)
	return nil
}

func TestQueueEventsCloseHonorsTimeoutWhileReadIsBlocked(t *testing.T) {
	backend := &stuckReadBackend{
		reading: make(chan struct{}, 1),
		release: make(chan struct{}),
		closed:  make(chan struct{}),
	}
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(backend.release) }) }
	t.Cleanup(release)

	qe, err := bullmq.NewQueueEvents("stuck-read", &bullmq.QueueEventsOptions{
		Backend: func(string, bullmq.BackendOptions) (bullmq.Backend, error) {
			return backend, nil
		},
		BlockingTimeout: 100 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("NewQueueEvents: %v", err)
	}

	runDone := make(chan struct{})
	go func() {
		defer close(runDone)
		_ = qe.Run(context.Background())
	}()
	select {
	case <-backend.reading:
	case <-time.After(5 * time.Second):
		t.Fatal("ReadEvents was never called")
	}

	closeDone := make(chan error, 1)
	go func() { closeDone <- qe.Close() }()

	// Close must give up waiting after BlockingTimeout+1s and close the
	// backend, even though the read is still blocked.
	select {
	case err := <-closeDone:
		if err != nil {
			t.Fatalf("Close: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Close stayed blocked behind the in-flight read")
	}
	select {
	case <-backend.closed:
	default:
		t.Fatal("backend was not closed")
	}

	release()
	select {
	case <-runDone:
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return once the read was released")
	}
}

// Run returns nil after Close, ctx's error when ctx is done, and
// ErrQueueEventsClosed when it was already called or the listener is
// closed, as Worker.Run does.
func TestQueueEventsRunReturnValues(t *testing.T) {
	forEachBackend(t, testQueueEventsRunReturnValues)
}

func testQueueEventsRunReturnValues(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	if _, err := q.Add(ctx, "job", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	newListener := func(t *testing.T) *bullmq.QueueEvents {
		t.Helper()
		qe, err := bullmq.NewQueueEvents(q.Name(), &bullmq.QueueEventsOptions{
			Backend:         be.Factory,
			LastEventID:     "0-0",
			BlockingTimeout: 200 * time.Millisecond,
		})
		if err != nil {
			t.Fatalf("NewQueueEvents: %v", err)
		}
		return qe
	}
	// start runs qe and returns once it delivered the event of the job
	// added above, so Run is known to be running.
	start := func(t *testing.T, qe *bullmq.QueueEvents, ctx context.Context) <-chan error {
		t.Helper()
		runDone := make(chan error, 1)
		go func() { runDone <- qe.Run(ctx) }()
		select {
		case <-qe.Events():
		case <-time.After(10 * time.Second):
			t.Fatal("no event was delivered")
		}
		return runDone
	}
	waitRun := func(t *testing.T, runDone <-chan error) error {
		t.Helper()
		select {
		case err := <-runDone:
			return err
		case <-time.After(10 * time.Second):
			t.Fatal("Run did not return")
			return nil
		}
	}

	t.Run("Close", func(t *testing.T) {
		qe := newListener(t)
		runDone := start(t, qe, context.Background())
		if err := qe.Close(); err != nil {
			t.Fatalf("Close: %v", err)
		}
		if err := waitRun(t, runDone); err != nil {
			t.Fatalf("Run after Close = %v, want nil", err)
		}
		if err := qe.Run(context.Background()); !errors.Is(err, bullmq.ErrQueueEventsClosed) {
			t.Fatalf("second Run = %v, want ErrQueueEventsClosed", err)
		}
	})

	t.Run("ctx", func(t *testing.T) {
		qe := newListener(t)
		t.Cleanup(func() { _ = qe.Close() })
		runCtx, cancel := context.WithCancel(context.Background())
		defer cancel()
		runDone := start(t, qe, runCtx)
		cancel()
		if err := waitRun(t, runDone); !errors.Is(err, context.Canceled) {
			t.Fatalf("Run after cancelling ctx = %v, want context.Canceled", err)
		}
		if err := qe.Run(context.Background()); !errors.Is(err, bullmq.ErrQueueEventsClosed) {
			t.Fatalf("second Run = %v, want ErrQueueEventsClosed", err)
		}
	})

	t.Run("closed before Run", func(t *testing.T) {
		qe := newListener(t)
		if err := qe.Close(); err != nil {
			t.Fatalf("Close: %v", err)
		}
		if err := qe.Run(context.Background()); !errors.Is(err, bullmq.ErrQueueEventsClosed) {
			t.Fatalf("Run after Close = %v, want ErrQueueEventsClosed", err)
		}
	})
}
