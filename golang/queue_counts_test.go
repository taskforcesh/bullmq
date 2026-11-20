package bullmq_test

import (
	"maps"
	"testing"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// CountsPerPriority counts the waiting jobs per priority, 0 being the jobs
// without one, as Node's getCountsPerPriority does.
func TestQueueCountsPerPriority(t *testing.T) {
	forEachBackend(t, testQueueCountsPerPriority)
}

func testQueueCountsPerPriority(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	for _, p := range []int64{0, 0, 1, 1, 1, 3, 7} {
		if _, err := q.Add(ctx, "job", nil, &bullmq.JobOptions{Priority: bullmq.Int64(p)}); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}
	// Delayed jobs are not waiting yet.
	if _, err := q.Add(ctx, "later", nil, &bullmq.JobOptions{Priority: bullmq.Int64(1), Delay: bullmq.Int64(60_000)}); err != nil {
		t.Fatalf("Add: %v", err)
	}

	got, err := q.CountsPerPriority(ctx, 0, 1, 2, 3, 7, 1)
	if err != nil {
		t.Fatalf("CountsPerPriority: %v", err)
	}
	want := map[int64]int64{0: 2, 1: 3, 2: 0, 3: 1, 7: 1}
	if !maps.Equal(got, want) {
		t.Fatalf("CountsPerPriority = %v, want %v", got, want)
	}

	// Pausing the queue doesn't change them.
	if err := q.Pause(ctx); err != nil {
		t.Fatalf("Pause: %v", err)
	}
	if got, err := q.CountsPerPriority(ctx, 0, 1); err != nil || !maps.Equal(got, map[int64]int64{0: 2, 1: 3}) {
		t.Fatalf("CountsPerPriority while paused = %v (%v), want map[0:2 1:3]", got, err)
	}

	if got, err := q.CountsPerPriority(ctx); err != nil || len(got) != 0 {
		t.Fatalf("CountsPerPriority() = %v (%v), want an empty map", got, err)
	}
}
