package bullmq_test

import (
	"context"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

func dedupKey(q *bullmq.Queue, id string) string { return q.Keys().Base() + ":de:" + id }

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
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)
	de := &bullmq.DeduplicationOptions{ID: "same"}

	first := addDeduped(t, ctx, q, "first", de, nil)
	second := addDeduped(t, ctx, q, "second", de, nil)
	if second.ID != first.ID {
		t.Fatalf("duplicate id = %s, want the original %s", second.ID, first.ID)
	}
	requireWaitingCount(t, ctx, q, bullmq.StateWaiting, 1)
	requireStoredData(t, ctx, q, first.ID, `"first"`)

	key := dedupKey(q, "same")
	if got, err := q.Client().Get(ctx, key).Result(); err != nil || got != first.ID {
		t.Fatalf("dedup key = %q (%v), want %q", got, err, first.ID)
	}
	if ttl, err := q.Client().PTTL(ctx, key).Result(); err != nil || ttl != -1 {
		t.Fatalf("simple-mode PTTL = %v (%v), want no expiry", ttl, err)
	}
	if deid, err := q.Client().HGet(ctx, q.Keys().Job(first.ID), "deid").Result(); err != nil || deid != "same" {
		t.Fatalf("job deid = %q (%v), want same", deid, err)
	}

	// A different deduplication id is independent.
	other := addDeduped(t, ctx, q, "other", &bullmq.DeduplicationOptions{ID: "different"}, nil)
	if other.ID == first.ID {
		t.Fatalf("different dedup id reused job %s", first.ID)
	}

	w := newTestWorker(t, q.Name(), func(context.Context, *bullmq.Job) (any, error) { return nil, nil }, nil)
	runWorker(t, w)
	waitFor(t, 10*time.Second, "both jobs to complete", func() bool {
		s1, _ := q.JobState(ctx, first.ID)
		s2, _ := q.JobState(ctx, other.ID)
		return s1 == bullmq.StateCompleted && s2 == bullmq.StateCompleted
	})
	waitFor(t, 5*time.Second, "dedup keys to be removed", func() bool {
		n, _ := q.Client().Exists(ctx, key, dedupKey(q, "different")).Result()
		return n == 0
	})

	// With the key gone the same id starts a new window.
	again := addDeduped(t, ctx, q, "again", de, nil)
	if again.ID == first.ID {
		t.Fatalf("add after completion returned the old job %s", first.ID)
	}
	requireStoredData(t, ctx, q, again.ID, `"again"`)
	if got, err := q.Client().Get(ctx, key).Result(); err != nil || got != again.ID {
		t.Fatalf("dedup key = %q (%v), want %q", got, err, again.ID)
	}
}

func TestDeduplicationTTLKeepsKeyUntilItExpires(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)
	de := &bullmq.DeduplicationOptions{ID: "ttl", TTL: 500}

	first := addDeduped(t, ctx, q, "first", de, nil)
	key := dedupKey(q, "ttl")
	if ttl, err := q.Client().PTTL(ctx, key).Result(); err != nil || ttl <= 0 || ttl > 500*time.Millisecond {
		t.Fatalf("PTTL = %v (%v), want within (0, 500ms]", ttl, err)
	}
	if dup := addDeduped(t, ctx, q, "dup", de, nil); dup.ID != first.ID {
		t.Fatalf("duplicate id = %s, want %s", dup.ID, first.ID)
	}

	// A TTL key is left to expire on its own rather than being deleted by completion.
	w := newTestWorker(t, q.Name(), func(context.Context, *bullmq.Job) (any, error) { return nil, nil }, nil)
	runWorker(t, w)
	waitFor(t, 10*time.Second, "job to complete", func() bool {
		s, _ := q.JobState(ctx, first.ID)
		return s == bullmq.StateCompleted
	})
	waitFor(t, 5*time.Second, "dedup key to expire", func() bool {
		n, _ := q.Client().Exists(ctx, key).Result()
		return n == 0
	})

	next := addDeduped(t, ctx, q, "next", de, nil)
	if next.ID == first.ID {
		t.Fatalf("add after expiry returned the old job %s", first.ID)
	}
	requireStoredData(t, ctx, q, first.ID, `"first"`)
	requireStoredData(t, ctx, q, next.ID, `"next"`)
}

func TestDeduplicationExtendRefreshesTheTTLOnDuplicates(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)

	pttlAfterDuplicate := func(t *testing.T, extend bool) time.Duration {
		q := newTestQueue(t, nil)
		de := &bullmq.DeduplicationOptions{ID: "ext", TTL: 3000, Extend: extend}
		first := addDeduped(t, ctx, q, "first", de, nil)
		time.Sleep(1200 * time.Millisecond)
		if dup := addDeduped(t, ctx, q, "dup", de, nil); dup.ID != first.ID {
			t.Fatalf("duplicate id = %s, want %s", dup.ID, first.ID)
		}
		requireStoredData(t, ctx, q, first.ID, `"first"`)
		requireWaitingCount(t, ctx, q, bullmq.StateWaiting, 1)
		ttl, err := q.Client().PTTL(ctx, dedupKey(q, "ext")).Result()
		if err != nil {
			t.Fatalf("PTTL: %v", err)
		}
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
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)
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
	key := dedupKey(q, "swap")
	if got, err := q.Client().Get(ctx, key).Result(); err != nil || got != second.ID {
		t.Fatalf("dedup key = %q (%v), want %q", got, err, second.ID)
	}
	if ttl, err := q.Client().PTTL(ctx, key).Result(); err != nil || ttl <= 0 || ttl > 60*time.Second {
		t.Fatalf("PTTL = %v (%v), want a live TTL", ttl, err)
	}

	// Replacing again keeps only the latest job.
	third := addDeduped(t, ctx, q, "third", de, delayed())
	requireJobGone(t, ctx, q, second.ID)
	requireStoredData(t, ctx, q, third.ID, `"third"`)
	requireWaitingCount(t, ctx, q, bullmq.StateDelayed, 1)
}

func TestDeduplicationReplaceKeepsTheTTLUnlessExtended(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)

	pttlAfterReplace := func(t *testing.T, extend bool) time.Duration {
		q := newTestQueue(t, nil)
		de := &bullmq.DeduplicationOptions{ID: "swap", TTL: 3000, Replace: true, Extend: extend}
		opts := func() *bullmq.JobOptions { return &bullmq.JobOptions{Delay: bullmq.Int64(60_000)} }
		addDeduped(t, ctx, q, "first", de, opts())
		time.Sleep(1200 * time.Millisecond)
		addDeduped(t, ctx, q, "second", de, opts())
		ttl, err := q.Client().PTTL(ctx, dedupKey(q, "swap")).Result()
		if err != nil {
			t.Fatalf("PTTL: %v", err)
		}
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
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)
	de := &bullmq.DeduplicationOptions{ID: "keep", TTL: 60_000, Replace: true}

	first := addDeduped(t, ctx, q, "first", de, nil) // waiting, not delayed
	second := addDeduped(t, ctx, q, "second", de, nil)
	if second.ID != first.ID {
		t.Fatalf("id = %s, want the original %s", second.ID, first.ID)
	}
	requireStoredData(t, ctx, q, first.ID, `"first"`)
	requireWaitingCount(t, ctx, q, bullmq.StateWaiting, 1)
}
