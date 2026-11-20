package bullmq_test

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// Cancelling the Run context (the usual signal.NotifyContext shutdown) must
// neither fail in-flight jobs nor use up their attempts: they stay active
// for the stalled check, as in Node.js.
func TestWorkerLeavesJobsActiveWhenRunIsCancelled(t *testing.T) {
	forEachBackend(t, testWorkerLeavesJobsActiveWhenRunIsCancelled)
}

func testWorkerLeavesJobsActiveWhenRunIsCancelled(t *testing.T, be testBackend) {
	for _, attempts := range []int64{1, 3} {
		t.Run(fmt.Sprintf("attempts=%d", attempts), func(t *testing.T) {
			ctx := testContext(t)
			q := newTestQueue(t, be, nil)
			job, err := q.Add(ctx, "interrupted", nil, &bullmq.JobOptions{Attempts: bullmq.Int64(attempts)})
			if err != nil {
				t.Fatalf("Add: %v", err)
			}

			hooks := &backendHooks{}
			started := make(chan struct{})
			w := newTestWorker(t, be, q.Name(), func(ctx context.Context, _ *bullmq.Job) (any, error) {
				close(started)
				<-ctx.Done()
				return nil, fmt.Errorf("interrupted: %w", ctx.Err())
			}, &bullmq.WorkerOptions{Backend: hooks.wrap(be.Factory), SkipStalledCheck: true})
			var log eventLog
			log.collect(w)
			runCtx, cancelRun := context.WithCancel(context.Background())
			runDone := make(chan error, 1)
			go func() { runDone <- w.Run(runCtx) }()
			t.Cleanup(func() { cancelRun(); _ = w.Close() })

			select {
			case <-started:
			case <-time.After(10 * time.Second):
				t.Fatal("the job did not start")
			}
			cancelRun()
			select {
			case <-runDone:
			case <-time.After(10 * time.Second):
				t.Fatal("Run did not return")
			}

			requireState(t, ctx, q, job.ID, bullmq.StateActive)
			stored, err := q.Job(ctx, job.ID)
			if err != nil {
				t.Fatalf("Job: %v", err)
			}
			if stored.AttemptsMade != 0 || stored.FailedReason != "" {
				t.Errorf("attemptsMade = %d, failedReason = %q; want 0 and none", stored.AttemptsMade, stored.FailedReason)
			}
			if n := hooks.failures.Load(); n != 0 {
				t.Errorf("the worker recorded %d failures for the interrupted job", n)
			}
			if n := log.count(bullmq.EventFailed); n != 0 {
				t.Errorf("EventFailed emitted %d times", n)
			}
		})
	}
}

// A job whose lock was lost may belong to another worker already, so its
// cancelled processor must not fail it.
func TestWorkerDoesNotFailAJobWhoseLockWasLost(t *testing.T) {
	forEachBackend(t, testWorkerDoesNotFailAJobWhoseLockWasLost)
}

func testWorkerDoesNotFailAJobWhoseLockWasLost(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	job, err := q.Add(ctx, "lost", nil, &bullmq.JobOptions{Attempts: bullmq.Int64(2)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	hooks := &backendHooks{}
	started := make(chan struct{})
	causes := make(chan error, 1)
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, _ *bullmq.Job) (any, error) {
		close(started)
		<-ctx.Done()
		causes <- context.Cause(ctx)
		return nil, ctx.Err()
	}, &bullmq.WorkerOptions{
		Backend:          hooks.wrap(be.Factory),
		LockDuration:     time.Second,
		LockRenewTime:    50 * time.Millisecond,
		SkipStalledCheck: true,
	})
	var log eventLog
	log.collect(w)
	runWorker(t, w)

	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("the job did not start")
	}
	if err := be.Fixture.DeleteLock(ctx, q.Backend(), job.ID); err != nil {
		t.Fatalf("DeleteLock: %v", err)
	}
	select {
	case cause := <-causes:
		if !errors.Is(cause, bullmq.ErrLockLost) {
			t.Errorf("context cause = %v, want ErrLockLost", cause)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the processor was not cancelled after its lock was lost")
	}
	waitFor(t, 5*time.Second, "the job to leave the worker", func() bool { return w.ActiveCount() == 0 })

	if n := hooks.failures.Load(); n != 0 {
		t.Errorf("the worker tried to record %d failures for a job whose lock was lost", n)
	}
	if n := log.count(bullmq.EventFailed); n != 0 {
		t.Errorf("EventFailed emitted %d times", n)
	}
	requireState(t, ctx, q, job.ID, bullmq.StateActive)
}

// CancelJob fails the job with the given reason, like Node.js's cancelJob,
// and only affects that job.
func TestWorkerCancelJobFailsTheJobWithTheReason(t *testing.T) {
	forEachBackend(t, testWorkerCancelJobFailsTheJobWithTheReason)
}

func testWorkerCancelJobFailsTheJobWithTheReason(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	ids := addJobs(t, ctx, q, 2)

	causes := make(chan error, 2)
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		select {
		case <-ctx.Done():
			causes <- context.Cause(ctx)
			return nil, ctx.Err()
		case <-time.After(time.Second):
			return "finished", nil
		}
	}, &bullmq.WorkerOptions{Concurrency: 2})
	var log eventLog
	log.collect(w)
	runWorker(t, w)

	waitFor(t, 10*time.Second, "both jobs to start", func() bool { return w.ActiveCount() == 2 })
	if w.CancelJob("no-such-job", "nope") {
		t.Error("CancelJob reported an unknown job as cancelled")
	}
	if !w.CancelJob(ids[0], "cancelled by the user") {
		t.Fatal("CancelJob did not find the active job")
	}
	select {
	case cause := <-causes:
		if !errors.Is(cause, bullmq.ErrJobCancelled) || cause.Error() != "cancelled by the user" {
			t.Errorf("context cause = %v, want the reason matching ErrJobCancelled", cause)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the cancelled processor did not observe the cancellation")
	}

	waitFor(t, 10*time.Second, "the cancelled job to fail", func() bool {
		state, err := q.JobState(ctx, ids[0])
		return err == nil && state == bullmq.StateFailed
	})
	stored, err := q.Job(ctx, ids[0])
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if stored.FailedReason != "cancelled by the user" {
		t.Errorf("failedReason = %q, want the cancellation reason", stored.FailedReason)
	}
	if got := log.jobsWith(bullmq.EventFailed); !slices.Equal(got, ids[:1]) {
		t.Errorf("failed events for %v, want %v", got, ids[:1])
	}
	waitFor(t, 10*time.Second, "the other job to complete", func() bool {
		state, err := q.JobState(ctx, ids[1])
		return err == nil && state == bullmq.StateCompleted
	})
}

// A job cancelled with CancelAllJobs is retried when attempts remain.
func TestWorkerCancelAllJobsRetriesJobsWithAttemptsLeft(t *testing.T) {
	forEachBackend(t, testWorkerCancelAllJobsRetriesJobsWithAttemptsLeft)
}

func testWorkerCancelAllJobsRetriesJobsWithAttemptsLeft(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	job, err := q.Add(ctx, "cancelled", nil, &bullmq.JobOptions{Attempts: bullmq.Int64(2)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	started := make(chan struct{}, 2)
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		started <- struct{}{}
		if job.AttemptsMade == 0 {
			<-ctx.Done()
			return nil, ctx.Err()
		}
		return "second time lucky", nil
	}, nil)
	runWorker(t, w)

	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("the job did not start")
	}
	w.CancelAllJobs("shutting the batch down")

	waitFor(t, 10*time.Second, "the retried job to complete", func() bool {
		state, err := q.JobState(ctx, job.ID)
		return err == nil && state == bullmq.StateCompleted
	})
	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if stored.AttemptsMade != 2 || !slices.Equal(stored.Stacktrace, []string{"shutting the batch down"}) {
		t.Errorf("attemptsMade = %d, stacktrace = %v; want 2 and the cancellation reason", stored.AttemptsMade, stored.Stacktrace)
	}
}
