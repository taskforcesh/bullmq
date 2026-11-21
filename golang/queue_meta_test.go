package bullmq_test

import (
	"errors"
	"sync"
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

// readerOf opens a second queue on the same name that never writes the
// metadata, to inspect it without triggering the first queue's write.
func readerOf(t *testing.T, be testBackend, name string) *bullmq.Queue {
	t.Helper()
	r, err := bullmq.NewQueue(name, &bullmq.QueueOptions{Backend: be.Factory, SkipMetasUpdate: true})
	if err != nil {
		t.Fatalf("NewQueue: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	return r
}

// A queue writes its version and events length before its first command, as
// Node's Queue does from its constructor.
func TestQueueWritesItsMetaBeforeItsFirstCommand(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		name := testQueueName(t)
		reader := readerOf(t, be, name)
		q := newNamedTestQueue(t, be, name, nil)

		if v, err := reader.Version(ctx); err != nil || v != "" {
			t.Fatalf("Version before the first command = %q, %v; want \"\"", v, err)
		}
		if _, err := q.Count(ctx); err != nil {
			t.Fatalf("Count: %v", err)
		}
		meta, err := reader.Meta(ctx)
		if err != nil {
			t.Fatalf("Meta: %v", err)
		}
		if want := "bullmq:" + bullmq.ScriptsVersion; meta.Version != want {
			t.Errorf("Version = %q, want %q", meta.Version, want)
		}
		if meta.MaxLenEvents == nil || *meta.MaxLenEvents != bullmq.DefaultEventsMaxLen {
			t.Errorf("MaxLenEvents = %v, want %d", meta.MaxLenEvents, bullmq.DefaultEventsMaxLen)
		}
		if v, err := q.Version(ctx); err != nil || v != meta.Version {
			t.Errorf("Queue.Version = %q, %v; want %q", v, err, meta.Version)
		}
	})
}

func TestQueueEventsMaxLenAndSkipMetasUpdate(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		q := newTestQueue(t, be, &bullmq.QueueOptions{EventsMaxLen: 250})
		meta, err := q.Meta(ctx)
		if err != nil {
			t.Fatalf("Meta: %v", err)
		}
		if meta.MaxLenEvents == nil || *meta.MaxLenEvents != 250 {
			t.Errorf("MaxLenEvents = %v, want 250", meta.MaxLenEvents)
		}

		skip := newTestQueue(t, be, &bullmq.QueueOptions{SkipMetasUpdate: true})
		if _, err := skip.Count(ctx); err != nil {
			t.Fatalf("Count: %v", err)
		}
		if v, err := skip.Version(ctx); err != nil || v != "" {
			t.Errorf("Version with SkipMetasUpdate = %q, %v; want \"\"", v, err)
		}
	})
	unused := func(string, bullmq.BackendOptions) (bullmq.Backend, error) { return nil, errors.New("not built") }
	var cfgErr *bullmq.ConfigError
	if _, err := bullmq.NewQueue("q", &bullmq.QueueOptions{Backend: unused, EventsMaxLen: -1}); !errors.As(err, &cfgErr) {
		t.Errorf("NewQueue with a negative EventsMaxLen = %v, want a ConfigError", err)
	}
}

// Obliterating a new queue, even while other goroutines use it, leaves no
// metadata behind: the write never lands after the obliterate (Node's
// #5187).
func TestObliterateLeavesNoQueueMeta(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		for range 5 {
			name := testQueueName(t)
			reader := readerOf(t, be, name)
			q := newNamedTestQueue(t, be, name, nil)
			var wg sync.WaitGroup
			for range 8 {
				wg.Go(func() {
					for range 5 {
						_, _ = q.Count(ctx)
					}
				})
			}
			if _, err := q.Add(ctx, "job", nil, nil); err != nil {
				t.Fatalf("Add: %v", err)
			}
			if err := q.Obliterate(ctx, &bullmq.ObliterateOptions{Force: true}); err != nil {
				t.Fatalf("Obliterate: %v", err)
			}
			wg.Wait()
			// Leave a late write time to land.
			time.Sleep(100 * time.Millisecond)
			if v, err := reader.Version(ctx); err != nil || v != "" {
				t.Fatalf("Version after Obliterate = %q, %v; want \"\"", v, err)
			}
		}
	})
}
