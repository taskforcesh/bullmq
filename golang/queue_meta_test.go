package bullmq_test

import (
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// Meta reads the queue metadata in one call, parsed as Node's getMeta
// parses it.
func TestQueueMeta(t *testing.T) {
	forEachBackend(t, testQueueMeta)
}

func testQueueMeta(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	if err := q.SetGlobalConcurrency(ctx, 4); err != nil {
		t.Fatalf("SetGlobalConcurrency: %v", err)
	}
	if err := q.SetGlobalRateLimit(ctx, 10, 2*time.Second); err != nil {
		t.Fatalf("SetGlobalRateLimit: %v", err)
	}
	if err := q.Pause(ctx); err != nil {
		t.Fatalf("Pause: %v", err)
	}
	if err := q.Backend().SetQueueMeta(ctx, map[string]any{
		"opts.maxLenEvents": 500,
		"version":           "bullmq:9.9.9",
	}); err != nil {
		t.Fatalf("SetQueueMeta: %v", err)
	}

	meta, err := q.Meta(ctx)
	if err != nil {
		t.Fatalf("Meta: %v", err)
	}
	check := func(name string, got *int64, want int64) {
		t.Helper()
		if got == nil || *got != want {
			t.Errorf("Meta().%s = %v, want %d", name, got, want)
		}
	}
	check("Concurrency", meta.Concurrency, 4)
	check("Max", meta.Max, 10)
	check("MaxLenEvents", meta.MaxLenEvents, 500)
	if meta.Duration == nil || *meta.Duration != 2*time.Second {
		t.Errorf("Meta().Duration = %v, want 2s", meta.Duration)
	}
	if !meta.Paused {
		t.Error("Meta().Paused = false, want true")
	}
	if meta.Version != "bullmq:9.9.9" {
		t.Errorf("Meta().Version = %q, want bullmq:9.9.9", meta.Version)
	}
	if v, err := q.Version(ctx); err != nil || v != "bullmq:9.9.9" {
		t.Errorf("Version() = %q, %v; want bullmq:9.9.9", v, err)
	}

	// Unset fields are nil, and a stored 0 is not mistaken for one.
	if err := q.RemoveGlobalRateLimit(ctx); err != nil {
		t.Fatalf("RemoveGlobalRateLimit: %v", err)
	}
	if err := q.Resume(ctx); err != nil {
		t.Fatalf("Resume: %v", err)
	}
	if err := q.Backend().SetQueueMeta(ctx, map[string]any{"concurrency": 0}); err != nil {
		t.Fatalf("SetQueueMeta: %v", err)
	}
	meta, err = q.Meta(ctx)
	if err != nil {
		t.Fatalf("Meta: %v", err)
	}
	check("Concurrency", meta.Concurrency, 0)
	if meta.Max != nil || meta.Duration != nil || meta.Paused {
		t.Errorf("Meta() = %+v, want no rate limit and not paused", meta)
	}
}

// A queue with no metadata reports none.
func TestQueueMetaOfAnEmptyQueue(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		q := newTestQueue(t, be, &bullmq.QueueOptions{})
		if err := q.Backend().RemoveQueueMetaFields(ctx, "version", "opts.maxLenEvents"); err != nil {
			t.Fatalf("RemoveQueueMetaFields: %v", err)
		}
		meta, err := q.Meta(ctx)
		if err != nil {
			t.Fatalf("Meta: %v", err)
		}
		if *meta != (bullmq.QueueMeta{}) {
			t.Errorf("Meta() = %+v, want an empty QueueMeta", meta)
		}
		if v, err := q.Version(ctx); err != nil || v != "" {
			t.Errorf("Version() = %q, %v; want \"\"", v, err)
		}
	})
}
