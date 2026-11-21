package bullmq_test

import (
	"context"
	"errors"
	"slices"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// Jobs and JobIDs take several states, as Node's getJobs does: the range
// applies to each state in turn, and no state means every state.
func TestQueueJobsInSeveralStates(t *testing.T) {
	forEachBackend(t, testQueueJobsInSeveralStates)
}

func testQueueJobsInSeveralStates(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	add := func(name string, opts *bullmq.JobOptions) string {
		t.Helper()
		job, err := q.Add(ctx, name, nil, opts)
		if err != nil {
			t.Fatalf("Add: %v", err)
		}
		return job.ID
	}

	ok, bad := add("ok", nil), add("bad", nil)
	w := newTestWorker(t, be, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
		if job.Name == "bad" {
			return nil, errors.New("boom")
		}
		return nil, nil
	}, nil)
	runWorker(t, w)
	waitFor(t, 10*time.Second, "the jobs to finish", func() bool {
		s1, _ := q.JobState(ctx, ok)
		s2, _ := q.JobState(ctx, bad)
		return s1 == bullmq.StateCompleted && s2 == bullmq.StateFailed
	})
	if err := w.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	w1, w2 := add("w1", nil), add("w2", nil)
	d1 := add("d1", &bullmq.JobOptions{Delay: bullmq.Int64(60_000)})
	d2 := add("d2", &bullmq.JobOptions{Delay: bullmq.Int64(120_000)})
	p1 := add("p1", &bullmq.JobOptions{Priority: bullmq.Int64(1)})
	p2 := add("p2", &bullmq.JobOptions{Priority: bullmq.Int64(2)})

	requireIDs := func(what string, start, end int64, asc bool, want []string, states ...bullmq.JobState) {
		t.Helper()
		got, err := q.JobIDs(ctx, start, end, asc, states...)
		if err != nil {
			t.Fatalf("%s: JobIDs: %v", what, err)
		}
		if !slices.Equal(got, want) {
			t.Fatalf("%s: JobIDs = %v, want %v", what, got, want)
		}
		jobs, err := q.Jobs(ctx, start, end, asc, states...)
		if err != nil {
			t.Fatalf("%s: Jobs: %v", what, err)
		}
		var ids []string
		for _, j := range jobs {
			ids = append(ids, j.ID)
		}
		if !slices.Equal(ids, want) {
			t.Fatalf("%s: Jobs = %v, want %v", what, ids, want)
		}
	}

	requireIDs("finished", 0, -1, false, []string{ok, bad}, bullmq.StateCompleted, bullmq.StateFailed)
	requireIDs("pending", 0, -1, true, []string{w1, w2, d1, d2, p1, p2},
		bullmq.StateWaiting, bullmq.StateDelayed, bullmq.StatePrioritized)
	// The descending order of prioritized jobs differs on PostgreSQL, whose
	// shared get_range orders them by ascending priority either way.
	requireIDs("pending, newest first", 0, -1, false, []string{w2, w1, d2, d1},
		bullmq.StateWaiting, bullmq.StateDelayed)
	// The range applies to each state. (A bounded ascending range of
	// waiting or active jobs is wrong on PostgreSQL: the shared get_range
	// slices them newest first.)
	requireIDs("the first of each state", 0, 0, true, []string{d1, p1},
		bullmq.StateDelayed, bullmq.StatePrioritized)
	requireIDs("the last of each state", 0, 0, false, []string{w2, d2},
		bullmq.StateWaiting, bullmq.StateDelayed)
	requireIDs("a repeated state", 0, -1, true, []string{w1, w2}, bullmq.StateWaiting, bullmq.StateWaiting)

	all, err := q.JobIDs(ctx, 0, -1, true)
	if err != nil {
		t.Fatalf("JobIDs(): %v", err)
	}
	slices.Sort(all)
	want := []string{ok, bad, w1, w2, d1, d2, p1, p2}
	slices.Sort(want)
	if !slices.Equal(all, want) {
		t.Fatalf("JobIDs() = %v, want every job %v", all, want)
	}
}
