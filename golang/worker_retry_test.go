package bullmq_test

import (
	"context"
	"errors"
	"math"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// A custom backoff that saturates (math.MaxInt64 milliseconds) must leave
// the job delayed, not overflow into a retry that is due at once.
func TestWorkerKeepsASaturatedRetryDelayed(t *testing.T) {
	forEachBackend(t, testWorkerKeepsASaturatedRetryDelayed)
}

func testWorkerKeepsASaturatedRetryDelayed(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	job, err := q.Add(ctx, "much-later", nil, &bullmq.JobOptions{
		Attempts: bullmq.Int64(3),
		Backoff:  &bullmq.Backoff{Type: "custom"},
	})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	var runs atomic.Int64
	w := newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) {
		runs.Add(1)
		return nil, errors.New("retry much later")
	}, &bullmq.WorkerOptions{
		BackoffStrategy: func(int64, bullmq.BackoffType, error, *bullmq.Job) int64 { return math.MaxInt64 },
	})
	runWorker(t, w)

	waitFor(t, 10*time.Second, "the job to be delayed", func() bool {
		state, err := q.JobState(ctx, job.ID)
		return err == nil && state == bullmq.StateDelayed
	})
	time.Sleep(500 * time.Millisecond)
	requireState(t, ctx, q, job.ID, bullmq.StateDelayed)
	if got := runs.Load(); got != 1 {
		t.Errorf("the processor ran %d times, want 1", got)
	}
	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if stored.AttemptsMade != 1 || stored.Delay < int64(100*365*24*time.Hour/time.Millisecond) {
		t.Errorf("attemptsMade = %d, delay = %dms; want 1 and a far-future delay", stored.AttemptsMade, stored.Delay)
	}
}

// Lock tracking is per attempt: when an immediate retry starts on another
// slot before the failed attempt has cleaned up, that cleanup must not stop
// the retry's lock from being renewed (.NET #5161).
func TestWorkerImmediateRetryOnAnotherSlotKeepsItsLockRenewed(t *testing.T) {
	forEachBackend(t, testWorkerImmediateRetryOnAnotherSlotKeepsItsLockRenewed)
}

func testWorkerImmediateRetryOnAnotherSlotKeepsItsLockRenewed(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	retryStarted := make(chan struct{})
	var startOnce sync.Once
	var calls atomic.Int64
	var heldFailure atomic.Bool
	var events eventLog
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, _ *bullmq.Job) (any, error) {
		if calls.Add(1) == 1 {
			return nil, errors.New("first attempt fails")
		}
		startOnce.Do(func() { close(retryStarted) })
		select {
		case <-time.After(2500 * time.Millisecond):
			return "ok", nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}, &bullmq.WorkerOptions{
		Concurrency:     2,
		LockDuration:    time.Second,
		StalledInterval: 300 * time.Millisecond,
		OnEvent: func(ev bullmq.Event) {
			events.add(ev)
			// Hold the first attempt's slot (its EventFailed is emitted before
			// it untracks the job) until the retry runs on the other slot.
			if ev.Type == bullmq.EventFailed && heldFailure.CompareAndSwap(false, true) {
				select {
				case <-retryStarted:
				case <-time.After(10 * time.Second):
				}
			}
		},
	})
	runWorker(t, w)

	job, err := q.Add(ctx, "retried", nil, &bullmq.JobOptions{Attempts: bullmq.Int64(2)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	waitFor(t, 15*time.Second, "the retried job to complete", func() bool {
		state, err := q.JobState(ctx, job.ID)
		return err == nil && state == bullmq.StateCompleted
	})
	// Give a wrongly stalled copy time to be picked up again.
	time.Sleep(time.Second)

	if got := calls.Load(); got != 2 {
		t.Errorf("the processor ran %d times, want 2", got)
	}
	for _, typ := range []bullmq.EventType{bullmq.EventStalled, bullmq.EventLockRenewalFailed} {
		if n := events.count(typ); n != 0 {
			t.Errorf("%s emitted %d times", typ, n)
		}
	}
	if n := events.count(bullmq.EventCompleted); n != 1 {
		t.Errorf("EventCompleted emitted %d times, want 1", n)
	}
	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if stored.AttemptsMade != 2 {
		t.Errorf("attemptsMade = %d, want 2", stored.AttemptsMade)
	}
}

// RemoveAll is stored as true (not {"count":0}, which the PostgreSQL commands
// read as "keep no finished job", #5160) and read back in that form.
func TestRemoveAllIsStoredAsTheBooleanForm(t *testing.T) {
	forEachBackend(t, testRemoveAllIsStoredAsTheBooleanForm)
}

func testRemoveAllIsStoredAsTheBooleanForm(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	job, err := q.Add(ctx, "ephemeral", nil, &bullmq.JobOptions{
		RemoveOnComplete: bullmq.RemoveAll(),
		RemoveOnFail:     bullmq.KeepCount(0),
	})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if !stored.Opts.RemoveOnComplete.IsRemoveAll() {
		t.Errorf("RemoveOnComplete read back as %+v, want RemoveAll", stored.Opts.RemoveOnComplete)
	}
	if got := stored.Opts.RemoveOnFail; got == nil || got.IsRemoveAll() || got.Count == nil || *got.Count != 0 {
		t.Errorf("RemoveOnFail read back as %+v, want a count of 0", got)
	}
}
