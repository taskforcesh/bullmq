package bullmq_test

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

func TestQueueAddStoresTheJob(t *testing.T) {
	forEachBackend(t, testQueueAddStoresTheJob)
}

func testQueueAddStoresTheJob(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	job, err := q.Add(ctx, "greet", map[string]string{"to": "world"}, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if job.ID == "" {
		t.Fatal("Add did not return a job id")
	}

	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if stored == nil {
		t.Fatal("the job was not persisted")
	}
	if stored.Name != "greet" {
		t.Errorf("Name = %q, want %q", stored.Name, "greet")
	}

	var payload map[string]string
	if err := stored.DecodeData(&payload); err != nil {
		t.Fatalf("DecodeData: %v", err)
	}
	if payload["to"] != "world" {
		t.Errorf("data = %v, want map[to:world]", payload)
	}

	state, err := q.JobState(ctx, job.ID)
	if err != nil {
		t.Fatalf("JobState: %v", err)
	}
	if state != bullmq.StateWaiting {
		t.Errorf("state = %q, want %q", state, bullmq.StateWaiting)
	}
}

func TestQueueAddUsesACustomJobID(t *testing.T) {
	forEachBackend(t, testQueueAddUsesACustomJobID)
}

func testQueueAddUsesACustomJobID(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	job, err := q.Add(ctx, "custom", 1, &bullmq.JobOptions{JobID: "my-id"})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if job.ID != "my-id" {
		t.Fatalf("ID = %q, want %q", job.ID, "my-id")
	}
}

func TestQueueAddPersistsJobOptions(t *testing.T) {
	forEachBackend(t, testQueueAddPersistsJobOptions)
}

func testQueueAddPersistsJobOptions(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	_, err := q.Add(ctx, "opts", nil, &bullmq.JobOptions{
		JobID:            "opts-1",
		Attempts:         bullmq.Int64(4),
		Backoff:          &bullmq.Backoff{Type: bullmq.BackoffExponential, Delay: 250},
		RemoveOnComplete: bullmq.KeepCount(10),
		LIFO:             bullmq.Bool(true),
	})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	stored, err := q.Job(ctx, "opts-1")
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if stored.Opts.Attempts == nil || *stored.Opts.Attempts != 4 {
		t.Errorf("Attempts = %v, want 4", stored.Opts.Attempts)
	}
	if stored.Opts.Backoff == nil || stored.Opts.Backoff.Type != bullmq.BackoffExponential {
		t.Errorf("Backoff = %+v, want exponential", stored.Opts.Backoff)
	}
	if stored.Opts.Backoff.Delay != 250 {
		t.Errorf("Backoff.Delay = %d, want 250", stored.Opts.Backoff.Delay)
	}
	if stored.Opts.LIFO == nil || !*stored.Opts.LIFO {
		t.Error("LIFO should have been persisted")
	}
	if stored.Opts.RemoveOnComplete == nil || stored.Opts.RemoveOnComplete.Count == nil ||
		*stored.Opts.RemoveOnComplete.Count != 10 {
		t.Errorf("RemoveOnComplete = %+v, want count 10", stored.Opts.RemoveOnComplete)
	}
}

func TestQueueDefaultJobOptionsAreApplied(t *testing.T) {
	forEachBackend(t, testQueueDefaultJobOptionsAreApplied)
}

func testQueueDefaultJobOptionsAreApplied(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, &bullmq.QueueOptions{
		DefaultJobOptions: &bullmq.JobOptions{Attempts: bullmq.Int64(7)},
	})

	job, err := q.Add(ctx, "defaults", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if stored.Opts.Attempts == nil || *stored.Opts.Attempts != 7 {
		t.Errorf("Attempts = %v, want 7", stored.Opts.Attempts)
	}
}

func TestQueueAddBulk(t *testing.T) {
	forEachBackend(t, testQueueAddBulk)
}

func testQueueAddBulk(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	specs := make([]bullmq.JobSpec, 0, 5)
	for i := range 5 {
		specs = append(specs, bullmq.JobSpec{Name: "bulk", Data: i})
	}
	jobs, err := q.AddBulk(ctx, specs)
	if err != nil {
		t.Fatalf("AddBulk: %v", err)
	}
	if len(jobs) != 5 {
		t.Fatalf("len(jobs) = %d, want 5", len(jobs))
	}

	counts, err := q.JobCounts(ctx, bullmq.StateWaiting)
	if err != nil {
		t.Fatalf("JobCounts: %v", err)
	}
	if counts[bullmq.StateWaiting] != 5 {
		t.Errorf("waiting = %d, want 5", counts[bullmq.StateWaiting])
	}
}

func TestQueueAddDelayedJob(t *testing.T) {
	forEachBackend(t, testQueueAddDelayedJob)
}

func testQueueAddDelayedJob(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	job, err := q.Add(ctx, "later", nil, &bullmq.JobOptions{Delay: bullmq.Int64(60_000)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	state, err := q.JobState(ctx, job.ID)
	if err != nil {
		t.Fatalf("JobState: %v", err)
	}
	if state != bullmq.StateDelayed {
		t.Fatalf("state = %q, want %q", state, bullmq.StateDelayed)
	}
}

func TestQueueAddPrioritizedJob(t *testing.T) {
	forEachBackend(t, testQueueAddPrioritizedJob)
}

func testQueueAddPrioritizedJob(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	job, err := q.Add(ctx, "urgent", nil, &bullmq.JobOptions{Priority: bullmq.Int64(1)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	state, err := q.JobState(ctx, job.ID)
	if err != nil {
		t.Fatalf("JobState: %v", err)
	}
	if state != bullmq.StatePrioritized {
		t.Fatalf("state = %q, want %q", state, bullmq.StatePrioritized)
	}
}

func TestQueueSizeLimitIsEnforced(t *testing.T) {
	forEachBackend(t, testQueueSizeLimitIsEnforced)
}

func testQueueSizeLimitIsEnforced(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	_, err := q.Add(ctx, "big", "a very long payload indeed", &bullmq.JobOptions{SizeLimit: bullmq.Int64(4)})
	if err == nil {
		t.Fatal("Add should have rejected an oversized payload")
	}
}

func TestQueuePauseAndResume(t *testing.T) {
	forEachBackend(t, testQueuePauseAndResume)
}

func testQueuePauseAndResume(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	if err := q.Pause(ctx); err != nil {
		t.Fatalf("Pause: %v", err)
	}
	paused, err := q.IsPaused(ctx)
	if err != nil {
		t.Fatalf("IsPaused: %v", err)
	}
	if !paused {
		t.Fatal("the queue should be paused")
	}

	if err := q.Resume(ctx); err != nil {
		t.Fatalf("Resume: %v", err)
	}
	paused, err = q.IsPaused(ctx)
	if err != nil {
		t.Fatalf("IsPaused: %v", err)
	}
	if paused {
		t.Fatal("the queue should be running")
	}
}

func TestQueueDrainRemovesWaitingJobs(t *testing.T) {
	forEachBackend(t, testQueueDrainRemovesWaitingJobs)
}

func testQueueDrainRemovesWaitingJobs(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	for range 3 {
		if _, err := q.Add(ctx, "drain-me", nil, nil); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}
	if err := q.Drain(ctx, true); err != nil {
		t.Fatalf("Drain: %v", err)
	}

	counts, err := q.JobCounts(ctx, bullmq.StateWaiting)
	if err != nil {
		t.Fatalf("JobCounts: %v", err)
	}
	if counts[bullmq.StateWaiting] != 0 {
		t.Errorf("waiting = %d, want 0", counts[bullmq.StateWaiting])
	}
}

func TestQueueJobIDsAndJobs(t *testing.T) {
	forEachBackend(t, testQueueJobIDsAndJobs)
}

func testQueueJobIDsAndJobs(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	for i := range 3 {
		if _, err := q.Add(ctx, "listed", i, nil); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}

	ids, err := q.JobIDs(ctx, 0, -1, false, bullmq.StateWaiting)
	if err != nil {
		t.Fatalf("JobIDs: %v", err)
	}
	if len(ids) != 3 {
		t.Fatalf("len(ids) = %d, want 3", len(ids))
	}

	jobs, err := q.Jobs(ctx, 0, -1, false, bullmq.StateWaiting)
	if err != nil {
		t.Fatalf("Jobs: %v", err)
	}
	if len(jobs) != 3 {
		t.Fatalf("len(jobs) = %d, want 3", len(jobs))
	}
	for _, job := range jobs {
		if job.Name != "listed" {
			t.Errorf("Name = %q, want %q", job.Name, "listed")
		}
	}
}

func TestQueueCount(t *testing.T) {
	forEachBackend(t, testQueueCount)
}

func testQueueCount(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	if _, err := q.Add(ctx, "a", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if _, err := q.Add(ctx, "b", nil, &bullmq.JobOptions{Delay: bullmq.Int64(60_000)}); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if _, err := q.Add(ctx, "c", nil, &bullmq.JobOptions{Priority: bullmq.Int64(2)}); err != nil {
		t.Fatalf("Add: %v", err)
	}

	count, err := q.Count(ctx)
	if err != nil {
		t.Fatalf("Count: %v", err)
	}
	if count != 3 {
		t.Fatalf("Count() = %d, want 3", count)
	}
}

func TestQueueObliterateRemovesEverything(t *testing.T) {
	forEachBackend(t, testQueueObliterateRemovesEverything)
}

func testQueueObliterateRemovesEverything(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	for range 3 {
		if _, err := q.Add(ctx, "sticky", nil, nil); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}
	if err := q.Obliterate(ctx, false, 100); err != nil {
		t.Fatalf("Obliterate: %v", err)
	}

	count, err := q.Count(ctx)
	if err != nil {
		t.Fatalf("Count: %v", err)
	}
	if count != 0 {
		t.Fatalf("Count() = %d, want 0", count)
	}
}

func TestQueueObliterateRefusesActiveJobsWithoutForce(t *testing.T) {
	forEachBackend(t, testQueueObliterateRefusesActiveJobsWithoutForce)
}

func testQueueObliterateRefusesActiveJobsWithoutForce(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	started := make(chan struct{})
	release := make(chan struct{})
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, _ *bullmq.Job) (any, error) {
		close(started)
		select {
		case <-release:
		case <-ctx.Done():
		}
		return nil, nil
	}, nil)
	runWorker(t, w)

	if _, err := q.Add(ctx, "busy", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("the job was never picked up")
	}

	if err := q.Obliterate(ctx, false, 100); err == nil {
		t.Error("Obliterate should refuse to run while there are active jobs")
	}
	close(release)
}

func TestQueueWorkersListsTheConnectedWorkers(t *testing.T) {
	forEachBackend(t, testQueueWorkersListsTheConnectedWorkers)
}

func testQueueWorkersListsTheConnectedWorkers(t *testing.T, be testBackend) {
	ctx := testContext(t)
	// PostgreSQL truncates connection names to 63 bytes, which the usual
	// test queue names would exceed.
	q := newNamedTestQueue(t, be, fmt.Sprintf("go-workers-%d", time.Now().UnixNano()), nil)
	noop := func(context.Context, *bullmq.Job) (any, error) { return nil, nil }

	if workers, err := q.Workers(ctx); err != nil || workers == nil || len(workers) != 0 {
		t.Fatalf("Workers without workers = %#v, %v; want an empty list", workers, err)
	}
	runWorker(t, newTestWorker(t, be, q.Name(), noop, nil))
	runWorker(t, newTestWorker(t, be, q.Name(), noop, &bullmq.WorkerOptions{Name: "mailer-1"}))
	// A queue events listener is connected too, but isn't a worker.
	collectEvents(t, be, q.Name())

	var workers []bullmq.WorkerInfo
	waitFor(t, 10*time.Second, "both workers to be listed", func() bool {
		var err error
		workers, err = q.Workers(ctx)
		return err == nil && len(workers) == 2
	})
	byName := map[string]bullmq.WorkerInfo{}
	for _, w := range workers {
		byName[w.Name] = w
	}
	unnamed, ok := byName[""]
	if !ok || unnamed.Fields["name"] != q.Backend().ClientName("") {
		t.Errorf("unnamed worker = %+v, want raw name %q", unnamed, q.Backend().ClientName(""))
	}
	named, ok := byName["mailer-1"]
	if !ok || named.Fields["name"] != q.Backend().ClientName(":w:mailer-1") {
		t.Errorf("named worker = %+v, want raw name %q", named, q.Backend().ClientName(":w:mailer-1"))
	}
	if be.Name == "redis" && (named.Fields["addr"] == "" || named.Fields["id"] == "") {
		t.Errorf("named worker fields = %v, want the CLIENT LIST fields", named.Fields)
	}
}

func TestQueueGlobalConcurrency(t *testing.T) {
	forEachBackend(t, testQueueGlobalConcurrency)
}

func testQueueGlobalConcurrency(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	requireLimit := func(what string, want *int64) {
		t.Helper()
		got, err := q.GlobalConcurrency(ctx)
		if err != nil {
			t.Fatalf("%s: GlobalConcurrency: %v", what, err)
		}
		if (got == nil) != (want == nil) || (got != nil && *got != *want) {
			t.Fatalf("%s: GlobalConcurrency() = %v, want %v", what, deref(got), deref(want))
		}
	}

	requireLimit("unset", nil)
	if err := q.SetGlobalConcurrency(ctx, 3); err != nil {
		t.Fatalf("SetGlobalConcurrency: %v", err)
	}
	requireLimit("set to 3", bullmq.Int64(3))

	if err := q.SetGlobalConcurrency(ctx, 0); err != nil {
		t.Fatalf("SetGlobalConcurrency(0): %v", err)
	}
	requireLimit("SetGlobalConcurrency(0)", nil)
	if maxed, err := q.IsMaxed(ctx); err != nil || maxed {
		t.Fatalf("IsMaxed without a limit = %v, %v; want false", maxed, err)
	}

	if err := q.SetGlobalConcurrency(ctx, 2); err != nil {
		t.Fatalf("SetGlobalConcurrency: %v", err)
	}
	if err := q.RemoveGlobalConcurrency(ctx); err != nil {
		t.Fatalf("RemoveGlobalConcurrency: %v", err)
	}
	requireLimit("RemoveGlobalConcurrency", nil)

	// Node's setGlobalConcurrency(0) stores 0, which maxes the queue out.
	if err := q.Backend().SetQueueMeta(ctx, map[string]any{"concurrency": 0}); err != nil {
		t.Fatalf("SetQueueMeta: %v", err)
	}
	requireLimit("0 stored by Node", bullmq.Int64(0))
	if maxed, err := q.IsMaxed(ctx); err != nil || !maxed {
		t.Fatalf("IsMaxed with a limit of 0 = %v, %v; want true", maxed, err)
	}
}

func deref[T any](p *T) any {
	if p == nil {
		return nil
	}
	return *p
}

// The global rate limit is stored as the max and duration queue metadata
// fields, as in Node.js, and can be read back and removed.
func TestQueueGlobalRateLimit(t *testing.T) {
	forEachBackend(t, testQueueGlobalRateLimit)
}

func testQueueGlobalRateLimit(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	requireLimit := func(want *bullmq.RateLimiter) {
		t.Helper()
		got, err := q.GlobalRateLimit(ctx)
		if err != nil {
			t.Fatalf("GlobalRateLimit: %v", err)
		}
		if (got == nil) != (want == nil) || (got != nil && *got != *want) {
			t.Fatalf("GlobalRateLimit() = %+v, want %+v", got, want)
		}
	}

	requireLimit(nil)
	if err := q.SetGlobalRateLimit(ctx, 5, 1500*time.Millisecond); err != nil {
		t.Fatalf("SetGlobalRateLimit: %v", err)
	}
	requireLimit(&bullmq.RateLimiter{Max: 5, Duration: 1500 * time.Millisecond})

	if err := q.RemoveGlobalRateLimit(ctx); err != nil {
		t.Fatalf("RemoveGlobalRateLimit: %v", err)
	}
	requireLimit(nil)

	if err := q.SetGlobalRateLimit(ctx, 5, time.Second); err != nil {
		t.Fatalf("SetGlobalRateLimit: %v", err)
	}
	if err := q.SetGlobalRateLimit(ctx, 0, time.Second); err != nil {
		t.Fatalf("SetGlobalRateLimit(0) = %v, want it to remove the limit", err)
	}
	requireLimit(nil)

	var cfgErr *bullmq.ConfigError
	if err := q.SetGlobalRateLimit(ctx, 5, 0); !errors.As(err, &cfgErr) {
		t.Fatalf("SetGlobalRateLimit(5, 0) = %v, want a ConfigError", err)
	}
}

// Removing the global rate limit lets workers fetch at full speed again.
func TestQueueRemoveGlobalRateLimitLiftsTheLimit(t *testing.T) {
	forEachBackend(t, testQueueRemoveGlobalRateLimitLiftsTheLimit)
}

func testQueueRemoveGlobalRateLimitLiftsTheLimit(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	// One job per minute: if the limit survived, only the first job would
	// be processed before the test times out.
	if err := q.SetGlobalRateLimit(ctx, 1, time.Minute); err != nil {
		t.Fatalf("SetGlobalRateLimit: %v", err)
	}
	if err := q.RemoveGlobalRateLimit(ctx); err != nil {
		t.Fatalf("RemoveGlobalRateLimit: %v", err)
	}

	var processed atomic.Int64
	w := newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) {
		processed.Add(1)
		return nil, nil
	}, nil)
	runWorker(t, w)
	for range 3 {
		if _, err := q.Add(ctx, "unlimited", nil, nil); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}
	waitFor(t, 10*time.Second, "every job to be processed", func() bool {
		return processed.Load() == 3
	})
}

func TestQueueCleanRemovesCompletedJobs(t *testing.T) {
	forEachBackend(t, testQueueCleanRemovesCompletedJobs)
}

func testQueueCleanRemovesCompletedJobs(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	done := make(chan struct{}, 1)
	w := newTestWorker(t, be, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		select {
		case done <- struct{}{}:
		default:
		}
		return nil, nil
	}, nil)
	runWorker(t, w)

	if _, err := q.Add(ctx, "cleanup", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	<-done

	waitFor(t, 5*time.Second, "the job to be completed", func() bool {
		counts, err := q.JobCounts(ctx, bullmq.StateCompleted)
		return err == nil && counts[bullmq.StateCompleted] == 1
	})

	removed, err := q.Clean(ctx, 0, 0, bullmq.StateCompleted)
	if err != nil {
		t.Fatalf("Clean: %v", err)
	}
	if len(removed) != 1 {
		t.Fatalf("Clean removed %d jobs, want 1", len(removed))
	}
}

func TestQueueCleanUnlimitedRunsInBatches(t *testing.T) {
	forEachBackend(t, testQueueCleanUnlimitedRunsInBatches)
}

func testQueueCleanUnlimitedRunsInBatches(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	// More than one 10,000-job batch, so the loop must run at least twice.
	const total = 10_050
	for added := 0; added < total; added += 1000 {
		n := min(1000, total-added)
		specs := make([]bullmq.JobSpec, n)
		for i := range specs {
			specs[i] = bullmq.JobSpec{Name: "j"}
		}
		if _, err := q.AddBulk(ctx, specs); err != nil {
			t.Fatalf("AddBulk: %v", err)
		}
	}

	removed, err := q.Clean(ctx, 0, 0, bullmq.StateWaiting)
	if err != nil {
		t.Fatalf("Clean: %v", err)
	}
	if len(removed) != total {
		t.Fatalf("Clean removed %d jobs, want %d", len(removed), total)
	}
	count, err := q.Count(ctx)
	if err != nil || count != 0 {
		t.Fatalf("Count = %d, err = %v; want 0", count, err)
	}
}

func TestQueueCleanHonoursLimit(t *testing.T) {
	forEachBackend(t, testQueueCleanHonoursLimit)
}

func testQueueCleanHonoursLimit(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	specs := make([]bullmq.JobSpec, 10)
	for i := range specs {
		specs[i] = bullmq.JobSpec{Name: "j"}
	}
	if _, err := q.AddBulk(ctx, specs); err != nil {
		t.Fatalf("AddBulk: %v", err)
	}
	removed, err := q.Clean(ctx, 0, 4, bullmq.StateWaiting)
	if err != nil {
		t.Fatalf("Clean: %v", err)
	}
	if len(removed) != 4 {
		t.Fatalf("Clean removed %d jobs, want 4", len(removed))
	}
}

// StatePaused, Node's legacy "paused" type, is accepted where Node accepts
// it. The jobs of a paused queue stay waiting, so the paused list is empty.
func TestQueueStatePausedIsTheLegacyPausedList(t *testing.T) {
	forEachBackend(t, testQueueStatePausedIsTheLegacyPausedList)
}

func testQueueStatePausedIsTheLegacyPausedList(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	if err := q.Pause(ctx); err != nil {
		t.Fatalf("Pause: %v", err)
	}
	if _, err := q.AddBulk(ctx, []bullmq.JobSpec{{Name: "a"}, {Name: "b"}}); err != nil {
		t.Fatalf("AddBulk: %v", err)
	}
	counts, err := q.JobCounts(ctx, bullmq.StateWaiting, bullmq.StatePaused)
	if err != nil {
		t.Fatalf("JobCounts: %v", err)
	}
	if counts[bullmq.StateWaiting] != 2 || counts[bullmq.StatePaused] != 0 {
		t.Fatalf("counts = %v, want 2 waiting and 0 paused", counts)
	}
	ids, err := q.JobIDs(ctx, 0, -1, true, bullmq.StatePaused)
	if err != nil || len(ids) != 0 {
		t.Fatalf("JobIDs(paused) = %v, %v; want none", ids, err)
	}

	removed, err := q.Clean(ctx, 0, 0, bullmq.StatePaused)
	if err != nil {
		t.Fatalf("Clean(paused): %v", err)
	}
	// The shared SQL cleans the waiting jobs for "paused", since PostgreSQL
	// has no paused list.
	want := 0
	if be.Name == "postgres" {
		want = 2
	}
	if len(removed) != want {
		t.Fatalf("Clean(paused) removed %v, want %d jobs", removed, want)
	}
}

func TestQueuePromoteJobsFarFuture(t *testing.T) {
	forEachBackend(t, testQueuePromoteJobsFarFuture)
}

func testQueuePromoteJobsFarFuture(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	// ~30 years: its delayed-set score (due timestamp * 4096) exceeds 2^53.
	job, err := q.Add(ctx, "delayed", nil, &bullmq.JobOptions{Delay: bullmq.Int64(30 * 365 * 24 * 3600 * 1000)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := q.PromoteJobs(ctx, 100); err != nil {
		t.Fatalf("PromoteJobs: %v", err)
	}
	state, err := q.JobState(ctx, job.ID)
	if err != nil {
		t.Fatalf("JobState: %v", err)
	}
	if state != bullmq.StateWaiting {
		t.Fatalf("state = %q, want %q", state, bullmq.StateWaiting)
	}
}

func TestQueuePromoteJobs(t *testing.T) {
	forEachBackend(t, testQueuePromoteJobs)
}

func testQueuePromoteJobs(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	job, err := q.Add(ctx, "delayed", nil, &bullmq.JobOptions{Delay: bullmq.Int64(600_000)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := q.PromoteJobs(ctx, 100); err != nil {
		t.Fatalf("PromoteJobs: %v", err)
	}

	state, err := q.JobState(ctx, job.ID)
	if err != nil {
		t.Fatalf("JobState: %v", err)
	}
	if state != bullmq.StateWaiting {
		t.Fatalf("state = %q, want %q", state, bullmq.StateWaiting)
	}
}
