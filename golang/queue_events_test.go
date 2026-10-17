package bullmq_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq/golang"
)

// collectEvents starts a QueueEvents listener and returns a snapshot function.
func collectEvents(t *testing.T, queueName string) func() []bullmq.QueueEvent {
	t.Helper()
	qe, err := bullmq.NewQueueEvents(queueName, &bullmq.QueueEventsOptions{
		Redis:           redisOptions(),
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
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)
	snapshot := collectEvents(t, q.Name())

	w := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
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
	requireRedis(t)
	q := newTestQueue(t, nil)

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
		Redis:           redisOptions(),
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
	unstarted, err := bullmq.NewQueueEvents(q.Name(), &bullmq.QueueEventsOptions{Redis: redisOptions()})
	if err != nil {
		t.Fatalf("NewQueueEvents: %v", err)
	}
	_ = unstarted.Close()
	drained(t, unstarted)
}

func TestQueueEventsReportsFailures(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)
	snapshot := collectEvents(t, q.Name())

	w := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
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
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)
	snapshot := collectEvents(t, q.Name())

	w := newTestWorker(t, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
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
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)
	snapshot := collectEvents(t, q.Name())

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
