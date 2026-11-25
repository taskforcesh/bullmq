package bullmq_test

import (
	"strconv"
	"strings"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// An Every scheduler produces no job due after its EndDate: the shared
// commands only compare EndDate with the current time (as Node.js does,
// taskforcesh/bullmq#5190), so the worker checks the next due time.
func TestJobSchedulerEveryStopsAtTheEndDate(t *testing.T) {
	forEachBackend(t, testJobSchedulerEveryStopsAtTheEndDate)
}

func testJobSchedulerEveryStopsAtTheEndDate(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	end := time.Now().Add(1100 * time.Millisecond).UnixMilli()
	if _, err := q.UpsertJobScheduler(ctx, "ending", bullmq.RepeatOptions{Every: 400, EndDate: end}, nil); err != nil {
		t.Fatalf("UpsertJobScheduler: %v", err)
	}
	p := runRecordingWorker(t, be, q, nil)
	waitFor(t, 10*time.Second, "the runs before the end date", func() bool { return len(p.snapshot()) >= 3 })
	time.Sleep(time.Until(time.UnixMilli(end)) + 800*time.Millisecond)

	ids := p.snapshot()
	for _, id := range ids {
		due, err := strconv.ParseInt(strings.TrimPrefix(id, "repeat:ending:"), 10, 64)
		if err != nil || due > end {
			t.Fatalf("processed %v: %s is due %dms after the end date", ids, id, due-end)
		}
	}
	if len(ids) != 3 {
		t.Fatalf("processed %v, want 3 runs", ids)
	}
	if pending := pendingSchedulerJobs(t, ctx, q); len(pending) != 0 {
		t.Fatalf("pending iterations %v after the end date, want none", pending)
	}
}
