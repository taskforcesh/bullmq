package bullmq_test

import (
	"context"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

func countEvents(events []bullmq.QueueEvent, name, jobID string) int {
	n := 0
	for _, ev := range events {
		if ev.Event == name && (jobID == "" || ev.JobID == jobID) {
			n++
		}
	}
	return n
}

// With KeepLastIfActive, the jobs added while the deduplicated job is
// active collapse into one more job, with the data of the last one, added
// when the active job finishes; the TTL is ignored.
func TestDeduplicationKeepLastIfActive(t *testing.T) {
	forEachBackend(t, testDeduplicationKeepLastIfActive)
}

func testDeduplicationKeepLastIfActive(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	events := collectEvents(t, be, q.Name())
	de := &bullmq.DeduplicationOptions{ID: "deploy", TTL: 300, KeepLastIfActive: true}

	var mu sync.Mutex
	var processed []string
	started := make(chan struct{})
	release := make(chan struct{})
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		var commit string
		if err := job.DecodeData(&commit); err != nil {
			return nil, err
		}
		mu.Lock()
		processed = append(processed, commit)
		first := len(processed) == 1
		mu.Unlock()
		if first {
			close(started)
			select {
			case <-release:
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		return nil, nil
	}, nil)
	runWorker(t, w)

	first := addDeduped(t, ctx, q, "c1", de, nil)
	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("the first job was not processed")
	}
	for _, commit := range []string{"c2", "c3", "c4"} {
		if dup := addDeduped(t, ctx, q, commit, de, nil); dup.ID != first.ID {
			t.Fatalf("Add(%s) = job %s, want the active job %s", commit, dup.ID, first.ID)
		}
	}
	// The TTL does not apply: the id is held while the job is active.
	time.Sleep(500 * time.Millisecond)
	if got, ttl, ok := dedupEntry(t, ctx, be, q, "deploy"); !ok || got != first.ID || ttl != -1 {
		t.Fatalf("dedup entry = %q, ttl %v, exists %v; want %q without expiry", got, ttl, ok, first.ID)
	}
	requireWaitingCount(t, ctx, q, bullmq.StateWaiting, 0)
	close(release)

	waitFor(t, 10*time.Second, "two jobs to be processed", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(processed) == 2
	})
	waitFor(t, 5*time.Second, "the deduplication id to be released", func() bool {
		id, err := q.DeduplicationJobID(ctx, "deploy")
		return err == nil && id == ""
	})
	time.Sleep(300 * time.Millisecond)
	mu.Lock()
	got := slices.Clone(processed)
	mu.Unlock()
	if want := []string{"c1", "c4"}; !slices.Equal(got, want) {
		t.Fatalf("processed %v, want %v", got, want)
	}
	waitFor(t, 5*time.Second, "three deduplicated events", func() bool {
		return countEvents(events(), "deduplicated", first.ID) == 3
	})
}

// A KeepLastIfActive job that is waiting, not active, deduplicates like the
// simple mode: nothing is kept for later.
func TestDeduplicationKeepLastIfActiveWhileWaiting(t *testing.T) {
	forEachBackend(t, testDeduplicationKeepLastIfActiveWhileWaiting)
}

func testDeduplicationKeepLastIfActiveWhileWaiting(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	de := &bullmq.DeduplicationOptions{ID: "waiting", KeepLastIfActive: true}

	first := addDeduped(t, ctx, q, "first", de, nil)
	if dup := addDeduped(t, ctx, q, "second", de, nil); dup.ID != first.ID {
		t.Fatalf("duplicate id = %s, want %s", dup.ID, first.ID)
	}

	var mu sync.Mutex
	var processed []string
	w := newTestWorker(t, be, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
		mu.Lock()
		processed = append(processed, string(job.Data))
		mu.Unlock()
		return nil, nil
	}, nil)
	runWorker(t, w)
	waitFor(t, 10*time.Second, "the job to complete", func() bool {
		s, _ := q.JobState(ctx, first.ID)
		return s == bullmq.StateCompleted
	})
	time.Sleep(500 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if want := []string{`"first"`}; !slices.Equal(processed, want) {
		t.Fatalf("processed %v, want %v", processed, want)
	}
}

// Reschedule moves a delayed job to the delay of the duplicate, keeping its
// id and data, and emits a delayed event; a job that is not delayed is left
// alone.
func TestDeduplicationReschedule(t *testing.T) {
	forEachBackend(t, testDeduplicationReschedule)
}

func testDeduplicationReschedule(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	events := collectEvents(t, be, q.Name())
	de := &bullmq.DeduplicationOptions{ID: "remind", Reschedule: true}

	original := addDeduped(t, ctx, q, "original", &bullmq.DeduplicationOptions{ID: "remind"},
		&bullmq.JobOptions{Delay: bullmq.Int64(60_000)})
	before := time.Now().UnixMilli()
	incoming := addDeduped(t, ctx, q, "incoming", de, &bullmq.JobOptions{Delay: bullmq.Int64(2_000)})
	if incoming.ID != original.ID {
		t.Fatalf("rescheduled id = %s, want %s", incoming.ID, original.ID)
	}
	stored, err := q.Job(ctx, original.ID)
	if err != nil || stored == nil {
		t.Fatalf("Job = %v, %v", stored, err)
	}
	if string(stored.Data) != `"original"` || stored.Delay != 2_000 {
		t.Fatalf("stored job data %s, delay %d; want the original data with a 2000ms delay", stored.Data, stored.Delay)
	}
	if state, err := stored.State(ctx); err != nil || state != bullmq.StateDelayed {
		t.Fatalf("state = %s (%v), want delayed", state, err)
	}
	requireWaitingCount(t, ctx, q, bullmq.StateDelayed, 1)
	waitFor(t, 5*time.Second, "the delayed events of the add and the reschedule", func() bool {
		evs := events()
		return countEvents(evs, "delayed", original.ID) == 2 && countEvents(evs, "deduplicated", original.ID) == 1
	})
	// The last delayed event carries the new due time.
	var due int64
	for _, ev := range events() {
		if ev.Event == "delayed" && ev.JobID == original.ID {
			due, _ = strconv.ParseInt(ev.Data["delay"], 10, 64)
		}
	}
	if due < before+2_000 || due > before+7_000 {
		t.Errorf("rescheduled due time = %d, want about %d", due, before+2_000)
	}

	// Without a delay, the job is due now.
	addDeduped(t, ctx, q, "now", de, nil)
	var mu sync.Mutex
	var processed []string
	w := newTestWorker(t, be, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
		mu.Lock()
		processed = append(processed, string(job.Data))
		mu.Unlock()
		return nil, nil
	}, nil)
	runWorker(t, w)
	waitFor(t, 10*time.Second, "the rescheduled job to complete", func() bool {
		s, _ := q.JobState(ctx, original.ID)
		return s == bullmq.StateCompleted
	})
	if elapsed := time.Now().UnixMilli() - before; elapsed > 30_000 {
		t.Fatalf("the job ran after %dms, want it rescheduled", elapsed)
	}
	mu.Lock()
	if want := []string{`"original"`}; !slices.Equal(processed, want) {
		t.Fatalf("processed %v, want %v", processed, want)
	}
	mu.Unlock()
}

func TestDeduplicationRescheduleLeavesAWaitingJob(t *testing.T) {
	forEachBackend(t, testDeduplicationRescheduleLeavesAWaitingJob)
}

func testDeduplicationRescheduleLeavesAWaitingJob(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	original := addDeduped(t, ctx, q, "original", &bullmq.DeduplicationOptions{ID: "w"}, nil)
	dup := addDeduped(t, ctx, q, "incoming", &bullmq.DeduplicationOptions{ID: "w", Reschedule: true},
		&bullmq.JobOptions{Delay: bullmq.Int64(60_000)})
	if dup.ID != original.ID {
		t.Fatalf("duplicate id = %s, want %s", dup.ID, original.ID)
	}
	stored, err := q.Job(ctx, original.ID)
	if err != nil || stored == nil {
		t.Fatalf("Job = %v, %v", stored, err)
	}
	if state, _ := stored.State(ctx); state != bullmq.StateWaiting || stored.Delay != 0 {
		t.Fatalf("job state %s, delay %d; want waiting without delay", state, stored.Delay)
	}
	requireWaitingCount(t, ctx, q, bullmq.StateDelayed, 0)
}

// As in Node.js, KeepLastIfActive can't be used on a flow node with a parent.
func TestFlowProducerRejectsKeepLastIfActiveOnAChild(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		q := newTestQueue(t, be, nil)
		fp := newTestFlowProducer(t, be)
		_, err := fp.Add(ctx, bullmq.FlowJob{Name: "root", QueueName: q.Name(), Children: []bullmq.FlowJob{{
			Name: "child", QueueName: q.Name(),
			Opts: &bullmq.JobOptions{Deduplication: &bullmq.DeduplicationOptions{ID: "x", KeepLastIfActive: true}},
		}}}, nil)
		if err == nil || !strings.Contains(err.Error(), "keepLastIfActive deduplication cannot be used on flow nodes with a parent") {
			t.Fatalf("Add error = %v, want the keepLastIfActive error", err)
		}
		if n, err := q.Count(ctx); err != nil || n != 0 {
			t.Fatalf("jobs added = %d (%v), want 0", n, err)
		}
	})
}
