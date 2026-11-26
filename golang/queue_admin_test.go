package bullmq_test

import (
	"context"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// Count is a batch size, not a cap: Obliterate removes every job, and Force
// removes the active ones too.
func TestQueueObliterateInBatches(t *testing.T) {
	forEachBackend(t, testQueueObliterateInBatches)
}

func testQueueObliterateInBatches(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	started := make(chan struct{})
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, _ *bullmq.Job) (any, error) {
		close(started)
		<-ctx.Done()
		return nil, ctx.Err()
	}, &bullmq.WorkerOptions{SkipStalledCheck: true})
	runWorker(t, w)
	if _, err := q.Add(ctx, "busy", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("the job was never picked up")
	}
	for range 7 {
		if _, err := q.Add(ctx, "job", nil, &bullmq.JobOptions{Delay: bullmq.Int64(60_000)}); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}

	if err := q.Obliterate(ctx, &bullmq.ObliterateOptions{Force: true, Count: 2}); err != nil {
		t.Fatalf("Obliterate: %v", err)
	}
	counts, err := q.JobCounts(ctx)
	if err != nil {
		t.Fatalf("JobCounts: %v", err)
	}
	for state, n := range counts {
		if n != 0 {
			t.Fatalf("%d %s jobs left after Obliterate, want none", n, state)
		}
	}

	// nil options obliterate an idle queue.
	if _, err := q.Add(ctx, "again", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := q.Obliterate(ctx, nil); err != nil {
		t.Fatalf("Obliterate(nil): %v", err)
	}
	if n, err := q.Count(ctx); err != nil || n != 0 {
		t.Fatalf("Count after Obliterate(nil) = %d, %v; want 0", n, err)
	}
}

// RateLimitTTL follows Node's getRateLimitTtl: with maxJobs 0 and no global
// rate limit it returns the raw time left in the window, -2 without one.
func TestQueueRateLimitTTL(t *testing.T) {
	forEachBackend(t, testQueueRateLimitTTL)
}

func testQueueRateLimitTTL(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	if ttl, err := q.RateLimitTTL(ctx, 0); err != nil || ttl != -2 {
		t.Fatalf("RateLimitTTL(0) without a window = %d, %v; want -2", ttl, err)
	}
	if ttl, err := q.RateLimitTTL(ctx, 5); err != nil || ttl != 0 {
		t.Fatalf("RateLimitTTL(5) without a window = %d, %v; want 0", ttl, err)
	}

	// A manual rate limit fills the window.
	if err := q.Backend().SetRateLimit(ctx, 10*time.Second); err != nil {
		t.Fatalf("SetRateLimit: %v", err)
	}
	for _, maxJobs := range []int64{0, 5} {
		ttl, err := q.RateLimitTTL(ctx, maxJobs)
		if err != nil || ttl <= 0 || ttl > 10_000 {
			t.Fatalf("RateLimitTTL(%d) while limited = %d, %v; want (0, 10000]", maxJobs, ttl, err)
		}
	}
	// With a global rate limit, maxJobs 0 uses its max.
	if err := q.SetGlobalRateLimit(ctx, 3, time.Second); err != nil {
		t.Fatalf("SetGlobalRateLimit: %v", err)
	}
	if ttl, err := q.RateLimitTTL(ctx, 0); err != nil || ttl <= 0 {
		t.Fatalf("RateLimitTTL(0) with a global rate limit = %d, %v; want > 0", ttl, err)
	}
}
