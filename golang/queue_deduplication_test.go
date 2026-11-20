package bullmq_test

import (
	"context"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// dedupEntry returns the job a deduplication id points at and the time left
// before the entry expires (-1 when it never expires).
func dedupEntry(t *testing.T, ctx context.Context, be testBackend, q *bullmq.Queue, id string) (string, time.Duration, bool) {
	t.Helper()
	jobID, ttl, ok, err := be.Fixture.Deduplication(ctx, q.Backend(), id)
	if err != nil {
		t.Fatalf("Deduplication(%s): %v", id, err)
	}
	return jobID, ttl, ok
}

func addDeduped(t *testing.T, ctx context.Context, q *bullmq.Queue, data string, de *bullmq.DeduplicationOptions, opts *bullmq.JobOptions) *bullmq.Job {
	t.Helper()
	if opts == nil {
		opts = &bullmq.JobOptions{}
	}
	opts.Deduplication = de
	job, err := q.Add(ctx, "dedup", data, opts)
	if err != nil {
		t.Fatalf("Add(%s): %v", data, err)
	}
	return job
}

func requireStoredData(t *testing.T, ctx context.Context, q *bullmq.Queue, id, want string) {
	t.Helper()
	stored, err := q.Job(ctx, id)
	if err != nil || stored == nil {
		t.Fatalf("Job(%s) = %v, %v; want the job", id, stored, err)
	}
	if string(stored.Data) != want {
		t.Fatalf("stored data of %s = %s, want %s", id, stored.Data, want)
	}
}

func requireJobGone(t *testing.T, ctx context.Context, q *bullmq.Queue, id string) {
	t.Helper()
	stored, err := q.Job(ctx, id)
	if err != nil || stored != nil {
		t.Fatalf("Job(%s) = %v, %v; want nil", id, stored, err)
	}
}

func requireWaitingCount(t *testing.T, ctx context.Context, q *bullmq.Queue, state bullmq.JobState, want int64) {
	t.Helper()
	counts, err := q.JobCounts(ctx, state)
	if err != nil {
		t.Fatalf("JobCounts: %v", err)
	}
	if counts[state] != want {
		t.Fatalf("%s jobs = %d, want %d", state, counts[state], want)
	}
}

func TestDeduplicationSuppressesDuplicatesAndClearsKeyOnCompletion(t *testing.T) {
	forEachBackend(t, testDeduplicationSuppressesDuplicatesAndClearsKeyOnCompletion)
}

func testDeduplicationSuppressesDuplicatesAndClearsKeyOnCompletion(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	de := &bullmq.DeduplicationOptions{ID: "same"}

	first := addDeduped(t, ctx, q, "first", de, nil)
	second := addDeduped(t, ctx, q, "second", de, nil)
	if second.ID != first.ID {
		t.Fatalf("duplicate id = %s, want the original %s", second.ID, first.ID)
	}
	requireWaitingCount(t, ctx, q, bullmq.StateWaiting, 1)
	requireStoredData(t, ctx, q, first.ID, `"first"`)

	if got, ttl, ok := dedupEntry(t, ctx, be, q, "same"); !ok || got != first.ID || ttl != -1 {
		t.Fatalf("dedup entry = %q, ttl %v, exists %v; want %q without expiry", got, ttl, ok, first.ID)
	}
	if deid, err := be.Fixture.JobDeduplicationID(ctx, q.Backend(), first.ID); err != nil || deid != "same" {
		t.Fatalf("job deid = %q (%v), want same", deid, err)
	}

	// A different deduplication id is independent.
	other := addDeduped(t, ctx, q, "other", &bullmq.DeduplicationOptions{ID: "different"}, nil)
	if other.ID == first.ID {
		t.Fatalf("different dedup id reused job %s", first.ID)
	}

	w := newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) { return nil, nil }, nil)
	runWorker(t, w)
	waitFor(t, 10*time.Second, "both jobs to complete", func() bool {
		s1, _ := q.JobState(ctx, first.ID)
		s2, _ := q.JobState(ctx, other.ID)
		return s1 == bullmq.StateCompleted && s2 == bullmq.StateCompleted
	})
	waitFor(t, 5*time.Second, "dedup entries to be removed", func() bool {
		_, _, same := dedupEntry(t, ctx, be, q, "same")
		_, _, different := dedupEntry(t, ctx, be, q, "different")
		return !same && !different
	})

	if err := w.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	// With the key gone the same id starts a new window.
	again := addDeduped(t, ctx, q, "again", de, nil)
	if again.ID == first.ID {
		t.Fatalf("add after completion returned the old job %s", first.ID)
	}
	requireStoredData(t, ctx, q, again.ID, `"again"`)
	if got, _, ok := dedupEntry(t, ctx, be, q, "same"); !ok || got != again.ID {
		t.Fatalf("dedup entry = %q (exists %v), want %q", got, ok, again.ID)
	}
}

func TestDeduplicationTTLKeepsKeyUntilItExpires(t *testing.T) {
	forEachBackend(t, testDeduplicationTTLKeepsKeyUntilItExpires)
}

func testDeduplicationTTLKeepsKeyUntilItExpires(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	de := &bullmq.DeduplicationOptions{ID: "ttl", TTL: 500}

	first := addDeduped(t, ctx, q, "first", de, nil)
	if _, ttl, ok := dedupEntry(t, ctx, be, q, "ttl"); !ok || ttl <= 0 || ttl > 500*time.Millisecond {
		t.Fatalf("dedup ttl = %v (exists %v), want within (0, 500ms]", ttl, ok)
	}
	if dup := addDeduped(t, ctx, q, "dup", de, nil); dup.ID != first.ID {
		t.Fatalf("duplicate id = %s, want %s", dup.ID, first.ID)
	}

	// A TTL key is left to expire on its own rather than being deleted by completion.
	w := newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) { return nil, nil }, nil)
	runWorker(t, w)
	waitFor(t, 10*time.Second, "job to complete", func() bool {
		s, _ := q.JobState(ctx, first.ID)
		return s == bullmq.StateCompleted
	})
	waitFor(t, 5*time.Second, "dedup entry to expire", func() bool {
		_, _, ok := dedupEntry(t, ctx, be, q, "ttl")
		return !ok
	})

	next := addDeduped(t, ctx, q, "next", de, nil)
	if next.ID == first.ID {
		t.Fatalf("add after expiry returned the old job %s", first.ID)
	}
	requireStoredData(t, ctx, q, first.ID, `"first"`)
	requireStoredData(t, ctx, q, next.ID, `"next"`)
}

func TestDeduplicationExtendRefreshesTheTTLOnDuplicates(t *testing.T) {
	forEachBackend(t, testDeduplicationExtendRefreshesTheTTLOnDuplicates)
}

func testDeduplicationExtendRefreshesTheTTLOnDuplicates(t *testing.T, be testBackend) {
	ctx := testContext(t)

	pttlAfterDuplicate := func(t *testing.T, extend bool) time.Duration {
		q := newTestQueue(t, be, nil)
		de := &bullmq.DeduplicationOptions{ID: "ext", TTL: 3000, Extend: extend}
		first := addDeduped(t, ctx, q, "first", de, nil)
		time.Sleep(1200 * time.Millisecond)
		if dup := addDeduped(t, ctx, q, "dup", de, nil); dup.ID != first.ID {
			t.Fatalf("duplicate id = %s, want %s", dup.ID, first.ID)
		}
		requireStoredData(t, ctx, q, first.ID, `"first"`)
		requireWaitingCount(t, ctx, q, bullmq.StateWaiting, 1)
		_, ttl, _ := dedupEntry(t, ctx, be, q, "ext")
		return ttl
	}

	if ttl := pttlAfterDuplicate(t, false); ttl <= 0 || ttl > 1900*time.Millisecond {
		t.Errorf("PTTL without extend = %v, want it to keep counting down (<= 1.9s)", ttl)
	}
	if ttl := pttlAfterDuplicate(t, true); ttl <= 2500*time.Millisecond || ttl > 3000*time.Millisecond {
		t.Errorf("PTTL with extend = %v, want it refreshed to about 3s", ttl)
	}
}

func TestDeduplicationReplaceSwapsTheDelayedJob(t *testing.T) {
	forEachBackend(t, testDeduplicationReplaceSwapsTheDelayedJob)
}

func testDeduplicationReplaceSwapsTheDelayedJob(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	de := &bullmq.DeduplicationOptions{ID: "swap", TTL: 60_000, Replace: true}
	delayed := func() *bullmq.JobOptions { return &bullmq.JobOptions{Delay: bullmq.Int64(60_000)} }

	first := addDeduped(t, ctx, q, "first", de, delayed())
	second := addDeduped(t, ctx, q, "second", de, delayed())
	if second.ID == first.ID {
		t.Fatalf("replacement reused id %s", first.ID)
	}
	requireJobGone(t, ctx, q, first.ID)
	requireStoredData(t, ctx, q, second.ID, `"second"`)
	requireWaitingCount(t, ctx, q, bullmq.StateDelayed, 1)
	if state, err := q.JobState(ctx, second.ID); err != nil || state != bullmq.StateDelayed {
		t.Fatalf("replacement state = %q (%v), want delayed", state, err)
	}
	if got, ttl, ok := dedupEntry(t, ctx, be, q, "swap"); !ok || got != second.ID || ttl <= 0 || ttl > 60*time.Second {
		t.Fatalf("dedup entry = %q, ttl %v, exists %v; want %q with a live TTL", got, ttl, ok, second.ID)
	}

	// Replacing again keeps only the latest job.
	third := addDeduped(t, ctx, q, "third", de, delayed())
	requireJobGone(t, ctx, q, second.ID)
	requireStoredData(t, ctx, q, third.ID, `"third"`)
	requireWaitingCount(t, ctx, q, bullmq.StateDelayed, 1)
}

func TestDeduplicationReplaceKeepsTheTTLUnlessExtended(t *testing.T) {
	forEachBackend(t, testDeduplicationReplaceKeepsTheTTLUnlessExtended)
}

func testDeduplicationReplaceKeepsTheTTLUnlessExtended(t *testing.T, be testBackend) {
	ctx := testContext(t)

	pttlAfterReplace := func(t *testing.T, extend bool) time.Duration {
		q := newTestQueue(t, be, nil)
		de := &bullmq.DeduplicationOptions{ID: "swap", TTL: 3000, Replace: true, Extend: extend}
		opts := func() *bullmq.JobOptions { return &bullmq.JobOptions{Delay: bullmq.Int64(60_000)} }
		addDeduped(t, ctx, q, "first", de, opts())
		time.Sleep(1200 * time.Millisecond)
		addDeduped(t, ctx, q, "second", de, opts())
		_, ttl, _ := dedupEntry(t, ctx, be, q, "swap")
		return ttl
	}

	if ttl := pttlAfterReplace(t, false); ttl <= 0 || ttl > 1900*time.Millisecond {
		t.Errorf("PTTL after replace without extend = %v, want <= 1.9s", ttl)
	}
	if ttl := pttlAfterReplace(t, true); ttl <= 2500*time.Millisecond {
		t.Errorf("PTTL after replace with extend = %v, want about 3s", ttl)
	}
}

func TestDeduplicationReplaceDoesNotTouchANonDelayedJob(t *testing.T) {
	forEachBackend(t, testDeduplicationReplaceDoesNotTouchANonDelayedJob)
}

func testDeduplicationReplaceDoesNotTouchANonDelayedJob(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	de := &bullmq.DeduplicationOptions{ID: "keep", TTL: 60_000, Replace: true}

	first := addDeduped(t, ctx, q, "first", de, nil) // waiting, not delayed
	second := addDeduped(t, ctx, q, "second", de, nil)
	if second.ID != first.ID {
		t.Fatalf("id = %s, want the original %s", second.ID, first.ID)
	}
	requireStoredData(t, ctx, q, first.ID, `"first"`)
	requireWaitingCount(t, ctx, q, bullmq.StateWaiting, 1)
}

func requireDeduplicationJobID(t *testing.T, ctx context.Context, q *bullmq.Queue, dedupID, want string) {
	t.Helper()
	got, err := q.DeduplicationJobID(ctx, dedupID)
	if err != nil {
		t.Fatalf("DeduplicationJobID(%s): %v", dedupID, err)
	}
	if got != want {
		t.Fatalf("DeduplicationJobID(%s) = %q, want %q", dedupID, got, want)
	}
}

// DeduplicationJobID reports the job holding a deduplication id, which
// every Job carries in DeduplicationID.
func TestQueueDeduplicationJobID(t *testing.T) {
	forEachBackend(t, testQueueDeduplicationJobID)
}

func testQueueDeduplicationJobID(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	requireDeduplicationJobID(t, ctx, q, "sync", "")
	first := addDeduped(t, ctx, q, "first", &bullmq.DeduplicationOptions{ID: "sync"}, nil)
	requireDeduplicationJobID(t, ctx, q, "sync", first.ID)
	if first.DeduplicationID != "sync" {
		t.Fatalf("added job DeduplicationID = %q, want sync", first.DeduplicationID)
	}
	stored, err := q.Job(ctx, first.ID)
	if err != nil || stored == nil {
		t.Fatalf("Job = %v, %v", stored, err)
	}
	if stored.DeduplicationID != "sync" {
		t.Fatalf("stored job DeduplicationID = %q, want sync", stored.DeduplicationID)
	}

	// A TTL that ran out releases the id.
	addDeduped(t, ctx, q, "short", &bullmq.DeduplicationOptions{ID: "short", TTL: 100}, nil)
	waitFor(t, 5*time.Second, "the deduplication TTL to run out", func() bool {
		id, err := q.DeduplicationJobID(ctx, "short")
		return err == nil && id == ""
	})
}

// Queue.RemoveDeduplicationKey releases a deduplication id whichever job
// holds it, so the next job with that id is added.
func TestQueueRemoveDeduplicationKey(t *testing.T) {
	forEachBackend(t, testQueueRemoveDeduplicationKey)
}

func testQueueRemoveDeduplicationKey(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	de := &bullmq.DeduplicationOptions{ID: "sync"}

	first := addDeduped(t, ctx, q, "first", de, nil)
	removed, err := q.RemoveDeduplicationKey(ctx, "sync")
	if err != nil || !removed {
		t.Fatalf("RemoveDeduplicationKey = %v, %v; want true", removed, err)
	}
	requireDeduplicationJobID(t, ctx, q, "sync", "")
	if removed, err := q.RemoveDeduplicationKey(ctx, "sync"); err != nil || removed {
		t.Fatalf("RemoveDeduplicationKey again = %v, %v; want false", removed, err)
	}

	second := addDeduped(t, ctx, q, "second", de, nil)
	if second.ID == first.ID {
		t.Fatalf("Add after RemoveDeduplicationKey returned the deduplicated job %s", first.ID)
	}
	requireDeduplicationJobID(t, ctx, q, "sync", second.ID)
	requireWaitingCount(t, ctx, q, bullmq.StateWaiting, 2)
}

// Job.RemoveDeduplicationKey only releases the id while the job holds it.
func TestJobRemoveDeduplicationKey(t *testing.T) {
	forEachBackend(t, testJobRemoveDeduplicationKey)
}

func testJobRemoveDeduplicationKey(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	de := &bullmq.DeduplicationOptions{ID: "sync"}

	plain, err := q.Add(ctx, "plain", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if removed, err := plain.RemoveDeduplicationKey(ctx); err != nil || removed {
		t.Fatalf("RemoveDeduplicationKey of a job without one = %v, %v; want false", removed, err)
	}

	first := addDeduped(t, ctx, q, "first", de, nil)
	if _, err := q.RemoveDeduplicationKey(ctx, "sync"); err != nil {
		t.Fatalf("Queue.RemoveDeduplicationKey: %v", err)
	}
	second := addDeduped(t, ctx, q, "second", de, nil)

	// The first job no longer holds the id, so it must not release it.
	if removed, err := first.RemoveDeduplicationKey(ctx); err != nil || removed {
		t.Fatalf("RemoveDeduplicationKey of a former holder = %v, %v; want false", removed, err)
	}
	requireDeduplicationJobID(t, ctx, q, "sync", second.ID)

	// A job read back from the datastore knows its deduplication id.
	stored, err := q.Job(ctx, second.ID)
	if err != nil || stored == nil {
		t.Fatalf("Job = %v, %v", stored, err)
	}
	if removed, err := stored.RemoveDeduplicationKey(ctx); err != nil || !removed {
		t.Fatalf("RemoveDeduplicationKey of the holder = %v, %v; want true", removed, err)
	}
	requireDeduplicationJobID(t, ctx, q, "sync", "")
}

// A processor can release its job's deduplication id while it runs, so a
// new job with the same id is accepted before this one finishes.
func TestJobRemoveDeduplicationKeyFromTheProcessor(t *testing.T) {
	forEachBackend(t, testJobRemoveDeduplicationKeyFromTheProcessor)
}

func testJobRemoveDeduplicationKeyFromTheProcessor(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	de := &bullmq.DeduplicationOptions{ID: "sync"}

	released := make(chan bool, 1)
	finish := make(chan struct{})
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		if string(job.Data) == `"first"` {
			removed, err := job.RemoveDeduplicationKey(ctx)
			if err != nil {
				return nil, err
			}
			released <- removed
			<-finish
		}
		return nil, nil
	}, nil)
	runWorker(t, w)
	defer close(finish)

	first := addDeduped(t, ctx, q, "first", de, nil)
	select {
	case removed := <-released:
		if !removed {
			t.Fatal("the processor could not release its deduplication id")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the job was not processed")
	}
	second, err := q.Add(ctx, "second", nil, &bullmq.JobOptions{Deduplication: de})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if second.ID == first.ID {
		t.Fatalf("Add while the first job runs returned it (%s), want a new job", first.ID)
	}
}
