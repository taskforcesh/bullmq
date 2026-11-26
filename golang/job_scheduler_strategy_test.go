package bullmq_test

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// rruleStrategy is a custom repeat strategy for RRULE-like patterns,
// `RRULE:FREQ=MILLISECONDLY;INTERVAL=<ms>;COUNT=<n>`: a run every INTERVAL
// milliseconds, COUNT runs in all.
func rruleStrategy(millis int64, opts bullmq.RepeatOptions, _ string) (int64, error) {
	rule, ok := strings.CutPrefix(opts.Pattern, "RRULE:")
	if !ok {
		return 0, fmt.Errorf("not an RRULE: %q", opts.Pattern)
	}
	var interval, count int64
	for _, part := range strings.Split(rule, ";") {
		key, value, _ := strings.Cut(part, "=")
		n, _ := strconv.ParseInt(value, 10, 64)
		switch key {
		case "INTERVAL":
			interval = n
		case "COUNT":
			count = n
		}
	}
	if interval <= 0 {
		return 0, fmt.Errorf("RRULE without an INTERVAL: %q", opts.Pattern)
	}
	if count > 0 && opts.Count >= count {
		return 0, nil
	}
	return millis + interval, nil
}

const rrule = "RRULE:FREQ=MILLISECONDLY;INTERVAL=300;COUNT=3"

// A custom repeat strategy replaces cron for Pattern schedulers, on the
// queue that upserts them and on the workers that advance them, as Node's
// settings.repeatStrategy does; 0 ends the schedule.
func TestJobSchedulerRepeatStrategy(t *testing.T) {
	forEachBackend(t, testJobSchedulerRepeatStrategy)
}

func testJobSchedulerRepeatStrategy(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, &bullmq.QueueOptions{RepeatStrategy: rruleStrategy})

	// Without the strategy, the pattern is a cron expression.
	plain, err := bullmq.NewQueue(q.Name(), &bullmq.QueueOptions{Backend: be.Factory})
	if err != nil {
		t.Fatalf("NewQueue: %v", err)
	}
	defer plain.Close()
	var cfg *bullmq.ConfigError
	if _, err := plain.UpsertJobScheduler(ctx, "rr", bullmq.RepeatOptions{Pattern: rrule}, nil); !errors.As(err, &cfg) {
		t.Fatalf("UpsertJobScheduler(RRULE) without a strategy = %v, want a ConfigError", err)
	}

	before := time.Now().UnixMilli()
	first, err := q.UpsertJobScheduler(ctx, "rr", bullmq.RepeatOptions{Pattern: rrule}, nil)
	if err != nil || first == nil {
		t.Fatalf("UpsertJobScheduler = %v, %v", first, err)
	}
	due, err := strconv.ParseInt(strings.TrimPrefix(first.ID, "repeat:rr:"), 10, 64)
	if err != nil || due < before+300 || due > time.Now().UnixMilli()+300 {
		t.Fatalf("first job %s, want one due 300ms after the upsert", first.ID)
	}
	if s := requireScheduler(t, ctx, q, "rr"); s.Pattern != rrule {
		t.Fatalf("stored pattern = %q, want %q", s.Pattern, rrule)
	}

	var errs errorRecorder
	p := runRecordingWorker(t, be, q, &bullmq.WorkerOptions{RepeatStrategy: rruleStrategy, OnEvent: errs.onEvent})
	waitFor(t, 10*time.Second, "the three runs", func() bool { return len(p.snapshot()) == 3 })
	time.Sleep(700 * time.Millisecond)
	ids := p.snapshot()
	if len(ids) != 3 || ids[0] != first.ID {
		t.Fatalf("processed %v, want three runs starting with %s", ids, first.ID)
	}
	for i := 1; i < len(ids); i++ {
		prev, _ := strconv.ParseInt(strings.TrimPrefix(ids[i-1], "repeat:rr:"), 10, 64)
		next, _ := strconv.ParseInt(strings.TrimPrefix(ids[i], "repeat:rr:"), 10, 64)
		if next-prev < 300 {
			t.Fatalf("runs %v are less than 300ms apart", ids)
		}
	}
	if pending := pendingSchedulerJobs(t, ctx, q); len(pending) != 0 {
		t.Fatalf("pending iterations %v after COUNT runs, want none", pending)
	}
	if got := errs.all(); len(got) != 0 {
		t.Fatalf("error events: %v", got)
	}
}

// A Go worker with the same strategy advances a scheduler stored by another
// port (here, as Node stores it), while a worker without it fails the
// iteration, unprocessed, since it can't compute the next run.
func TestJobSchedulerRepeatStrategyAdvancesNodeSchedulers(t *testing.T) {
	forEachBackend(t, testJobSchedulerRepeatStrategyAdvancesNodeSchedulers)
}

func testJobSchedulerRepeatStrategyAdvancesNodeSchedulers(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	pattern := "RRULE:FREQ=MILLISECONDLY;INTERVAL=60000"

	firstID := addSchedulerAsNode(t, ctx, q, "node-rr", pattern, "")
	p := runRecordingWorker(t, be, q, &bullmq.WorkerOptions{RepeatStrategy: rruleStrategy})
	waitFor(t, 10*time.Second, "the first iteration", func() bool { return len(p.snapshot()) == 1 })
	waitFor(t, 10*time.Second, "the next iteration", func() bool { return len(pendingSchedulerJobs(t, ctx, q)) == 1 })
	// The strategy gets the time of the fetch (at least the due time of the
	// fetched iteration), as in Node.js.
	prev, _ := strconv.ParseInt(strings.TrimPrefix(firstID, "repeat:node-rr:"), 10, 64)
	pending := pendingSchedulerJobs(t, ctx, q)
	next, err := strconv.ParseInt(strings.TrimPrefix(pending[0], "repeat:node-rr:"), 10, 64)
	if err != nil || next < prev+60_000 || next > time.Now().UnixMilli()+60_000 {
		t.Fatalf("next iteration %v, want one due 60s after the first was fetched (%d)", pending, prev)
	}

	other := newSuffixedQueue(t, be, "plain")
	jobID := addSchedulerAsNode(t, ctx, other, "node-rr", pattern, "")
	var errs errorRecorder
	plain := runRecordingWorker(t, be, other, &bullmq.WorkerOptions{OnEvent: errs.onEvent})
	waitFor(t, 10*time.Second, "the iteration to fail", func() bool {
		s, _ := other.JobState(ctx, jobID)
		return s == bullmq.StateFailed
	})
	if got := plain.snapshot(); len(got) != 0 {
		t.Fatalf("a worker without the strategy processed %v", got)
	}
	if len(errs.all()) == 0 {
		t.Fatal("no error event from the worker without the strategy")
	}
}
