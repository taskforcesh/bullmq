package bullmq_test

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// A job started more often than MaxStartedAttempts fails unrecoverably
// instead of running again.
func TestWorkerMaxStartedAttemptsFailsTheJob(t *testing.T) {
	forEachBackend(t, testWorkerMaxStartedAttemptsFailsTheJob)
}

func testWorkerMaxStartedAttemptsFailsTheJob(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	job, err := q.Add(ctx, "restarted", nil, &bullmq.JobOptions{Attempts: bullmq.Int64(3)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	var runs atomic.Int64
	w := newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) {
		runs.Add(1)
		return nil, errors.New("try again")
	}, &bullmq.WorkerOptions{MaxStartedAttempts: 1})
	runWorker(t, w)

	waitFor(t, 10*time.Second, "the job to fail", func() bool {
		state, err := q.JobState(ctx, job.ID)
		return err == nil && state == bullmq.StateFailed
	})
	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if stored.FailedReason != "job started more than allowable limit" {
		t.Errorf("failedReason = %q", stored.FailedReason)
	}
	if got := runs.Load(); got != 1 {
		t.Errorf("the processor ran %d times, want 1", got)
	}
}

// A deferred failure set by the stalled check wins over MaxStartedAttempts,
// as in Node.js.
func TestWorkerDeferredFailureTakesPrecedenceOverMaxStartedAttempts(t *testing.T) {
	forEachBackend(t, testWorkerDeferredFailureTakesPrecedenceOverMaxStartedAttempts)
}

func testWorkerDeferredFailureTakesPrecedenceOverMaxStartedAttempts(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	job, err := q.Add(ctx, "stalls", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	// The first worker takes the job and hangs without renewing its lock.
	hang := make(chan struct{})
	stuck := make(chan struct{})
	stalling := newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) {
		close(stuck)
		<-hang
		return nil, nil
	}, &bullmq.WorkerOptions{LockDuration: 300 * time.Millisecond, SkipLockRenewal: true, SkipStalledCheck: true})
	stallingCtx, cancelStalling := context.WithCancel(context.Background())
	t.Cleanup(func() {
		close(hang)
		cancelStalling()
		_ = stalling.Close()
	})
	go func() { _ = stalling.Run(stallingCtx) }()
	select {
	case <-stuck:
	case <-time.After(10 * time.Second):
		t.Fatal("the first worker never picked up the job")
	}

	// The rescuer's stalled check records a deferred failure (no stall is
	// allowed) and moves the job back to wait; the rescuer then starts it a
	// second time, beyond MaxStartedAttempts too.
	var runs atomic.Int64
	rescuer := newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) {
		runs.Add(1)
		return nil, nil
	}, &bullmq.WorkerOptions{
		MaxStalledCount:    bullmq.Int(0),
		MaxStartedAttempts: 1,
		StalledInterval:    100 * time.Millisecond,
	})
	runWorker(t, rescuer)

	waitFor(t, 10*time.Second, "the stalled job to fail", func() bool {
		state, err := q.JobState(ctx, job.ID)
		return err == nil && state == bullmq.StateFailed
	})
	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if stored.FailedReason != "job stalled more than allowable limit" {
		t.Errorf("failedReason = %q, want the deferred failure", stored.FailedReason)
	}
	if got := runs.Load(); got != 0 {
		t.Errorf("the rescuer ran the processor %d times, want 0", got)
	}
}

// StackTraceLimit keeps only the most recent failure traces; without it,
// every trace is kept, as in Node.js.
func TestWorkerHonoursStackTraceLimit(t *testing.T) {
	forEachBackend(t, testWorkerHonoursStackTraceLimit)
}

func testWorkerHonoursStackTraceLimit(t *testing.T, be testBackend) {
	traces := func(from, to int) []string {
		var out []string
		for i := from; i <= to; i++ {
			out = append(out, fmt.Sprintf("failure %d", i))
		}
		return out
	}
	for _, tc := range []struct {
		name     string
		limit    *int64
		attempts int64
		want     []string
	}{
		{name: "unset", attempts: 12, want: traces(1, 12)},
		{name: "two", limit: bullmq.Int64(2), attempts: 4, want: traces(3, 4)},
		{name: "zero", limit: bullmq.Int64(0), attempts: 2, want: []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := testContext(t)
			q := newTestQueue(t, be, nil)
			job, err := q.Add(ctx, "failing", nil, &bullmq.JobOptions{
				Attempts:        bullmq.Int64(tc.attempts),
				StackTraceLimit: tc.limit,
			})
			if err != nil {
				t.Fatalf("Add: %v", err)
			}
			var runs atomic.Int64
			w := newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) {
				return nil, fmt.Errorf("failure %d", runs.Add(1))
			}, nil)
			runWorker(t, w)

			waitFor(t, 20*time.Second, "the job to fail", func() bool {
				state, err := q.JobState(ctx, job.ID)
				return err == nil && state == bullmq.StateFailed
			})
			stored, err := q.Job(ctx, job.ID)
			if err != nil {
				t.Fatalf("Job: %v", err)
			}
			if !slices.Equal(stored.Stacktrace, tc.want) && !(len(stored.Stacktrace) == 0 && len(tc.want) == 0) {
				t.Errorf("stacktrace = %q, want %q", stored.Stacktrace, tc.want)
			}
			if got := stored.Opts.StackTraceLimit; (got == nil) != (tc.limit == nil) || (got != nil && *got != *tc.limit) {
				t.Errorf("stored StackTraceLimit = %v, want %v", got, tc.limit)
			}
		})
	}
}

// A processor that reports ErrRateLimited (usually after Worker.RateLimit)
// puts its job back in the wait list without using up an attempt, and the
// worker waits until the limit lifts.
func TestWorkerManualRateLimit(t *testing.T) {
	forEachBackend(t, testWorkerManualRateLimit)
}

func testWorkerManualRateLimit(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	job, err := q.Add(ctx, "limited", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	var w *bullmq.Worker
	runs := make(chan time.Time, 2)
	w = newTestWorker(t, be, q.Name(), func(ctx context.Context, _ *bullmq.Job) (any, error) {
		runs <- time.Now()
		if len(runs) == 1 {
			if err := w.RateLimit(ctx, 600*time.Millisecond); err != nil {
				return nil, err
			}
			return nil, fmt.Errorf("external API said slow down: %w", bullmq.ErrRateLimited)
		}
		return "done", nil
	}, &bullmq.WorkerOptions{Limiter: &bullmq.RateLimiter{Max: 100, Duration: time.Second}})
	var log eventLog
	log.collect(w)
	runWorker(t, w)

	waitFor(t, 10*time.Second, "the job to complete", func() bool {
		state, err := q.JobState(ctx, job.ID)
		return err == nil && state == bullmq.StateCompleted
	})
	first, second := <-runs, <-runs
	if gap := second.Sub(first); gap < 500*time.Millisecond {
		t.Errorf("the job ran again after %v, before the 600ms rate limit lifted", gap)
	}
	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if stored.AttemptsMade != 1 || stored.FailedReason != "" {
		t.Errorf("attemptsMade = %d, failedReason = %q; want 1 and none", stored.AttemptsMade, stored.FailedReason)
	}
	if n := log.count(bullmq.EventFailed); n != 0 {
		t.Errorf("EventFailed emitted %d times", n)
	}
}
