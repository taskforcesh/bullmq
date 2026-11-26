package bullmq_test

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// Job.Retry keeps the attempt counters unless asked to reset them, as Node's
// job.retry does: a job that used up its attempts gets them back only with
// ResetAttemptsMade.
func TestJobRetryResetsAttempts(t *testing.T) {
	forEachBackend(t, testJobRetryResetsAttempts)
}

func testJobRetryResetsAttempts(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	var runs atomic.Int64

	// processUntilFailed runs a worker until the job failed for good, after
	// want runs in total.
	processUntilFailed := func(jobID string, want int64) *bullmq.Job {
		t.Helper()
		w := newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) {
			runs.Add(1)
			return nil, errors.New("boom")
		}, nil)
		runWorker(t, w)
		waitFor(t, 10*time.Second, "the job to fail for good", func() bool {
			s, _ := q.JobState(ctx, jobID)
			return s == bullmq.StateFailed && runs.Load() >= want
		})
		if err := w.Close(); err != nil {
			t.Fatalf("Close: %v", err)
		}
		if got := runs.Load(); got != want {
			t.Fatalf("runs = %d, want %d", got, want)
		}
		stored, err := q.Job(ctx, jobID)
		if err != nil || stored == nil {
			t.Fatalf("Job = %v, %v", stored, err)
		}
		return stored
	}

	job, err := q.Add(ctx, "flaky", nil, &bullmq.JobOptions{Attempts: bullmq.Int64(2)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	stored := processUntilFailed(job.ID, 2)
	if stored.AttemptsMade != 2 || stored.AttemptsStarted != 2 {
		t.Fatalf("counters = %d made, %d started; want 2 and 2", stored.AttemptsMade, stored.AttemptsStarted)
	}

	if err := stored.Retry(ctx, bullmq.StateFailed, &bullmq.RetryOptions{ResetAttemptsMade: true, ResetAttemptsStarted: true}); err != nil {
		t.Fatalf("Retry: %v", err)
	}
	if stored.AttemptsMade != 0 || stored.AttemptsStarted != 0 {
		t.Fatalf("Job counters after Retry = %d, %d; want 0 and 0", stored.AttemptsMade, stored.AttemptsStarted)
	}
	reread, err := q.Job(ctx, job.ID)
	if err != nil || reread == nil {
		t.Fatalf("Job = %v, %v", reread, err)
	}
	if reread.AttemptsMade != 0 || reread.AttemptsStarted != 0 {
		t.Fatalf("stored counters after Retry = %d, %d; want 0 and 0", reread.AttemptsMade, reread.AttemptsStarted)
	}
	// Both attempts are available again.
	stored = processUntilFailed(job.ID, 4)
	if stored.AttemptsMade != 2 {
		t.Fatalf("attempts made = %d, want 2", stored.AttemptsMade)
	}

	// Without a reset, the job fails for good after one more run.
	if err := stored.Retry(ctx, bullmq.StateFailed, nil); err != nil {
		t.Fatalf("Retry: %v", err)
	}
	if stored.AttemptsMade != 2 {
		t.Fatalf("Job attempts made after Retry = %d, want 2", stored.AttemptsMade)
	}
	stored = processUntilFailed(job.ID, 5)
	if stored.AttemptsMade != 3 || stored.AttemptsStarted != 3 {
		t.Fatalf("counters = %d made, %d started; want 3 and 3", stored.AttemptsMade, stored.AttemptsStarted)
	}
}
