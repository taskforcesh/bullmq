package bullmq_test

import (
	"context"
	"errors"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// RetryJobs moves every failed (or completed) job finished before a time
// back to wait, in batches, as Node's retryJobs does.
func TestQueueRetryJobs(t *testing.T) {
	forEachBackend(t, testQueueRetryJobs)
}

func testQueueRetryJobs(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	w := newTestWorker(t, be, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
		if job.Name == "ok" {
			return nil, nil
		}
		return nil, errors.New("boom")
	}, nil)
	runWorker(t, w)

	addAndWait := func(names ...string) {
		t.Helper()
		var ids []string
		for _, name := range names {
			job, err := q.Add(ctx, name, nil, nil)
			if err != nil {
				t.Fatalf("Add: %v", err)
			}
			ids = append(ids, job.ID)
		}
		waitFor(t, 10*time.Second, "the jobs to finish", func() bool {
			for _, id := range ids {
				if s, _ := q.JobState(ctx, id); s != bullmq.StateFailed && s != bullmq.StateCompleted {
					return false
				}
			}
			return true
		})
	}
	addAndWait("fail", "fail", "fail")
	time.Sleep(50 * time.Millisecond)
	cutoff := time.Now()
	time.Sleep(50 * time.Millisecond)
	addAndWait("fail", "fail", "ok", "ok")
	if err := w.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	requireCounts := func(what string, want bullmq.JobCounts) {
		t.Helper()
		got, err := q.JobCounts(ctx, bullmq.StateWaiting, bullmq.StateFailed, bullmq.StateCompleted)
		if err != nil {
			t.Fatalf("JobCounts: %v", err)
		}
		for state, n := range want {
			if got[state] != n {
				t.Fatalf("%s: counts = %v, want %v", what, got, want)
			}
		}
	}
	requireCounts("before", bullmq.JobCounts{bullmq.StateWaiting: 0, bullmq.StateFailed: 5, bullmq.StateCompleted: 2})

	// Only the jobs that failed before the cutoff, in batches of 2.
	if err := q.RetryJobs(ctx, &bullmq.RetryJobsOptions{Before: cutoff, Count: 2}); err != nil {
		t.Fatalf("RetryJobs: %v", err)
	}
	requireCounts("after retrying the old failures", bullmq.JobCounts{bullmq.StateWaiting: 3, bullmq.StateFailed: 2, bullmq.StateCompleted: 2})

	// The failed state is the default.
	if err := q.RetryJobs(ctx, nil); err != nil {
		t.Fatalf("RetryJobs: %v", err)
	}
	requireCounts("after retrying every failure", bullmq.JobCounts{bullmq.StateWaiting: 5, bullmq.StateFailed: 0, bullmq.StateCompleted: 2})

	if err := q.RetryJobs(ctx, &bullmq.RetryJobsOptions{State: bullmq.StateCompleted, Count: 1}); err != nil {
		t.Fatalf("RetryJobs(completed): %v", err)
	}
	requireCounts("after retrying the completed jobs", bullmq.JobCounts{bullmq.StateWaiting: 7, bullmq.StateFailed: 0, bullmq.StateCompleted: 0})

	var cfg *bullmq.ConfigError
	if err := q.RetryJobs(ctx, &bullmq.RetryJobsOptions{State: bullmq.StateActive}); !errors.As(err, &cfg) {
		t.Fatalf("RetryJobs(active) = %v, want a ConfigError", err)
	}
}
