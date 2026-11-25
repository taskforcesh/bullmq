package bullmq_test

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// A processor that moves its job back to wait and returns ErrWaiting gets
// the job again later, without using up an attempt, as with Node's
// moveToWait and WaitingError.
func TestJobMoveToWait(t *testing.T) {
	forEachBackend(t, testJobMoveToWait)
}

func testJobMoveToWait(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	events := collectEvents(t, be, q.Name())

	var runs atomic.Int32
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		if runs.Add(1) == 1 {
			if err := job.MoveToWait(ctx); err != nil {
				return nil, err
			}
			return nil, bullmq.ErrWaiting
		}
		return "done", nil
	}, nil)
	failed := make(chan error, 1)
	go func() {
		for ev := range w.Events() {
			if ev.Type == bullmq.EventFailed || ev.Type == bullmq.EventError {
				select {
				case failed <- ev.Err:
				default:
				}
			}
		}
	}()
	runWorker(t, w)

	job, err := q.Add(ctx, "step", nil, &bullmq.JobOptions{Attempts: bullmq.Int64(1)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	waitFor(t, 10*time.Second, "the job to complete", func() bool {
		s, _ := q.JobState(ctx, job.ID)
		return s == bullmq.StateCompleted
	})
	select {
	case err := <-failed:
		t.Fatalf("unexpected failure: %v", err)
	default:
	}
	if n := runs.Load(); n != 2 {
		t.Fatalf("runs = %d, want 2", n)
	}
	stored, err := q.Job(ctx, job.ID)
	if err != nil || stored == nil {
		t.Fatalf("Job = %v, %v", stored, err)
	}
	if stored.AttemptsMade != 1 {
		t.Fatalf("attempts made = %d, want 1: moving back to wait doesn't count", stored.AttemptsMade)
	}
	waitFor(t, 5*time.Second, "the waiting event of the move", func() bool {
		for _, ev := range events() {
			if ev.Event == "waiting" && ev.JobID == job.ID && ev.Data["prev"] == "active" {
				return true
			}
		}
		return false
	})
}

// MoveToWait checks the job's lock.
func TestJobMoveToWaitChecksTheLock(t *testing.T) {
	forEachBackend(t, testJobMoveToWaitChecksTheLock)
}

func testJobMoveToWaitChecksTheLock(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	result := make(chan error, 1)
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		if err := be.Fixture.SetLock(ctx, q.Backend(), job.ID, "someone-else", time.Minute); err != nil {
			return nil, err
		}
		result <- job.MoveToWait(ctx)
		<-ctx.Done()
		return nil, ctx.Err()
	}, &bullmq.WorkerOptions{SkipLockRenewal: true, SkipStalledCheck: true})
	runWorker(t, w)
	if _, err := q.Add(ctx, "locked", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	select {
	case err := <-result:
		var se *bullmq.ScriptError
		if !errors.As(err, &se) {
			t.Fatalf("MoveToWait with another lock = %v, want a ScriptError", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the job was not processed")
	}
}
