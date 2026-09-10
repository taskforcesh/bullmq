package bullmq_test

import (
	"context"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq/golang"
)

func TestQueueAddStoresTheJob(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

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
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	job, err := q.Add(ctx, "custom", 1, &bullmq.JobOptions{JobID: "my-id"})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if job.ID != "my-id" {
		t.Fatalf("ID = %q, want %q", job.ID, "my-id")
	}
}

func TestQueueAddPersistsJobOptions(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	_, err := q.Add(ctx, "opts", nil, &bullmq.JobOptions{
		JobID:            "opts-1",
		Attempts:         4,
		Backoff:          &bullmq.Backoff{Type: bullmq.BackoffExponential, Delay: 250},
		RemoveOnComplete: bullmq.KeepCount(10),
		LIFO:             true,
	})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	stored, err := q.Job(ctx, "opts-1")
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if stored.Opts.Attempts != 4 {
		t.Errorf("Attempts = %d, want 4", stored.Opts.Attempts)
	}
	if stored.Opts.Backoff == nil || stored.Opts.Backoff.Type != bullmq.BackoffExponential {
		t.Errorf("Backoff = %+v, want exponential", stored.Opts.Backoff)
	}
	if stored.Opts.Backoff.Delay != 250 {
		t.Errorf("Backoff.Delay = %d, want 250", stored.Opts.Backoff.Delay)
	}
	if !stored.Opts.LIFO {
		t.Error("LIFO should have been persisted")
	}
	if stored.Opts.RemoveOnComplete == nil || stored.Opts.RemoveOnComplete.Count == nil ||
		*stored.Opts.RemoveOnComplete.Count != 10 {
		t.Errorf("RemoveOnComplete = %+v, want count 10", stored.Opts.RemoveOnComplete)
	}
}

func TestQueueDefaultJobOptionsAreApplied(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, &bullmq.QueueOptions{
		DefaultJobOptions: &bullmq.JobOptions{Attempts: 7},
	})

	job, err := q.Add(ctx, "defaults", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if stored.Opts.Attempts != 7 {
		t.Errorf("Attempts = %d, want 7", stored.Opts.Attempts)
	}
}

func TestQueueAddBulk(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

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
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	job, err := q.Add(ctx, "later", nil, &bullmq.JobOptions{Delay: 60_000})
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
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	job, err := q.Add(ctx, "urgent", nil, &bullmq.JobOptions{Priority: 1})
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
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	_, err := q.Add(ctx, "big", "a very long payload indeed", &bullmq.JobOptions{SizeLimit: 4})
	if err == nil {
		t.Fatal("Add should have rejected an oversized payload")
	}
}

func TestQueuePauseAndResume(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

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
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

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
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	for i := range 3 {
		if _, err := q.Add(ctx, "listed", i, nil); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}

	ids, err := q.JobIDs(ctx, bullmq.StateWaiting, 0, -1, false)
	if err != nil {
		t.Fatalf("JobIDs: %v", err)
	}
	if len(ids) != 3 {
		t.Fatalf("len(ids) = %d, want 3", len(ids))
	}

	jobs, err := q.Jobs(ctx, bullmq.StateWaiting, 0, -1, false)
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
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	if _, err := q.Add(ctx, "a", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if _, err := q.Add(ctx, "b", nil, &bullmq.JobOptions{Delay: 60_000}); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if _, err := q.Add(ctx, "c", nil, &bullmq.JobOptions{Priority: 2}); err != nil {
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
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

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
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	started := make(chan struct{})
	release := make(chan struct{})
	w := newTestWorker(t, q.Name(), func(ctx context.Context, _ *bullmq.Job) (any, error) {
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

func TestQueueGlobalConcurrency(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	if err := q.SetGlobalConcurrency(ctx, 3); err != nil {
		t.Fatalf("SetGlobalConcurrency: %v", err)
	}
	got, err := q.GlobalConcurrency(ctx)
	if err != nil {
		t.Fatalf("GlobalConcurrency: %v", err)
	}
	if got != 3 {
		t.Fatalf("GlobalConcurrency() = %d, want 3", got)
	}

	if err := q.SetGlobalConcurrency(ctx, 0); err != nil {
		t.Fatalf("SetGlobalConcurrency(0): %v", err)
	}
	got, err = q.GlobalConcurrency(ctx)
	if err != nil {
		t.Fatalf("GlobalConcurrency: %v", err)
	}
	if got != 0 {
		t.Fatalf("GlobalConcurrency() = %d, want 0", got)
	}
}

func TestQueueCleanRemovesCompletedJobs(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	done := make(chan struct{}, 1)
	w := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
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

func TestQueuePromoteJobs(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	job, err := q.Add(ctx, "delayed", nil, &bullmq.JobOptions{Delay: 600_000})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if _, err := q.PromoteJobs(ctx, 100); err != nil {
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
