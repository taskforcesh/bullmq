package bullmq_test

import (
	"context"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// With a worker concurrency above the queue's global concurrency, the fetch
// loop parks waiting for work while the only permitted job runs. Finishing
// that job must wake it rather than leave the queued job waiting for the
// drain delay.
func TestWorkerConcurrencyAboveGlobalConcurrencyDoesNotStallQueuedJobs(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)
	if err := q.SetGlobalConcurrency(ctx, 1); err != nil {
		t.Fatalf("SetGlobalConcurrency: %v", err)
	}

	const jobs = 4
	for i := range jobs {
		if _, err := q.Add(ctx, "work", i, nil); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}

	running := make(chan struct{}, 1)
	w := newTestWorker(t, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		select {
		case running <- struct{}{}:
		default:
			t.Error("two jobs ran at once despite a global concurrency of 1")
		}
		time.Sleep(100 * time.Millisecond)
		<-running
		return nil, nil
	}, &bullmq.WorkerOptions{Concurrency: 2, DrainDelay: 5 * time.Second})

	start := time.Now()
	runWorker(t, w)
	waitFor(t, 3*time.Second, "all queued jobs to complete", func() bool {
		counts, err := q.JobCounts(ctx, bullmq.StateCompleted)
		return err == nil && counts[bullmq.StateCompleted] == jobs
	})
	t.Logf("%d jobs completed in %s", jobs, time.Since(start))
}
