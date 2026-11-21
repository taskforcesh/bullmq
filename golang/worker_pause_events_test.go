package bullmq_test

import (
	"context"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// The worker emits EventPaused once Pause has waited for the jobs in
// flight, and EventResumed on Resume, as Node's paused and resumed events,
// once per change.
func TestWorkerPauseAndResumeEvents(t *testing.T) {
	forEachBackend(t, testWorkerPauseAndResumeEvents)
}

func testWorkerPauseAndResumeEvents(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	release := make(chan struct{})
	var log eventLog
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		<-release
		return nil, nil
	}, &bullmq.WorkerOptions{OnEvent: log.add})
	runWorker(t, w)
	job, err := q.Add(ctx, "job", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	waitFor(t, 10*time.Second, "the job to start", func() bool { return w.ActiveCount() == 1 })

	paused := make(chan error, 1)
	go func() { paused <- w.Pause(ctx, false) }()
	time.Sleep(200 * time.Millisecond)
	if n := log.count(bullmq.EventPaused); n != 0 {
		t.Fatalf("EventPaused emitted %d times while Pause waited for the job", n)
	}
	close(release)
	if err := <-paused; err != nil {
		t.Fatalf("Pause: %v", err)
	}
	// The job's transition is done once Pause returns; its EventCompleted
	// is emitted concurrently, so it may come after EventPaused.
	if n := log.count(bullmq.EventPaused); n != 1 {
		t.Fatalf("EventPaused emitted %d times once Pause returned, want 1 (events %v)", n, log.types())
	}
	requireState(t, ctx, q, job.ID, bullmq.StateCompleted)

	// Pausing a paused worker, or resuming a running one, emits nothing.
	if err := w.Pause(ctx, true); err != nil {
		t.Fatalf("Pause: %v", err)
	}
	w.Resume()
	w.Resume()
	if err := w.Pause(ctx, true); err != nil {
		t.Fatalf("Pause: %v", err)
	}
	w.Resume()
	if p, r := log.count(bullmq.EventPaused), log.count(bullmq.EventResumed); p != 2 || r != 2 {
		t.Errorf("%d EventPaused and %d EventResumed, want 2 of each", p, r)
	}
}
