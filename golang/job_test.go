package bullmq_test

import (
	"context"
	"errors"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq/golang"
)

func TestJobUpdateProgress(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	job, err := q.Add(ctx, "progress", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := job.UpdateProgress(ctx, bullmq.NumberProgress(50)); err != nil {
		t.Fatalf("UpdateProgress: %v", err)
	}

	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	n, ok := stored.Progress.Number()
	if !ok || n != 50 {
		t.Fatalf("progress = %v (%v), want 50", n, ok)
	}
}

func TestJobUpdateProgressWithAStruct(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	job, err := q.Add(ctx, "progress", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	progress, err := bullmq.JSONProgress(map[string]any{"step": "upload", "pct": 10})
	if err != nil {
		t.Fatalf("JSONProgress: %v", err)
	}
	if err := job.UpdateProgress(ctx, progress); err != nil {
		t.Fatalf("UpdateProgress: %v", err)
	}

	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	var out struct {
		Step string `json:"step"`
		Pct  int    `json:"pct"`
	}
	if err := stored.Progress.Decode(&out); err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if out.Step != "upload" || out.Pct != 10 {
		t.Fatalf("progress = %+v", out)
	}
}

func TestJobUpdateData(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	job, err := q.Add(ctx, "data", map[string]int{"v": 1}, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := job.UpdateData(ctx, map[string]int{"v": 2}); err != nil {
		t.Fatalf("UpdateData: %v", err)
	}

	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	var out map[string]int
	if err := stored.DecodeData(&out); err != nil {
		t.Fatalf("DecodeData: %v", err)
	}
	if out["v"] != 2 {
		t.Fatalf("data = %v, want map[v:2]", out)
	}
}

func TestJobLogs(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	job, err := q.Add(ctx, "logged", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	for _, line := range []string{"first", "second"} {
		if _, err := job.Log(ctx, line); err != nil {
			t.Fatalf("Log: %v", err)
		}
	}

	logs, total, err := job.Logs(ctx, 0, -1)
	if err != nil {
		t.Fatalf("Logs: %v", err)
	}
	if total != 2 {
		t.Fatalf("total = %d, want 2", total)
	}
	if len(logs) != 2 || logs[0] != "first" || logs[1] != "second" {
		t.Fatalf("logs = %v", logs)
	}
}

func TestJobRemove(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	job, err := q.Add(ctx, "removable", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := job.Remove(ctx, false); err != nil {
		t.Fatalf("Remove: %v", err)
	}

	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if stored != nil {
		t.Fatal("the job should have been removed")
	}
}

func TestJobPromote(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	job, err := q.Add(ctx, "delayed", nil, &bullmq.JobOptions{Delay: 600_000})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := job.Promote(ctx); err != nil {
		t.Fatalf("Promote: %v", err)
	}

	state, err := job.State(ctx)
	if err != nil {
		t.Fatalf("State: %v", err)
	}
	if state != bullmq.StateWaiting {
		t.Fatalf("state = %q, want %q", state, bullmq.StateWaiting)
	}
}

func TestJobChangeDelay(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	job, err := q.Add(ctx, "delayed", nil, &bullmq.JobOptions{Delay: 600_000})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := job.ChangeDelay(ctx, 5*time.Millisecond); err != nil {
		t.Fatalf("ChangeDelay: %v", err)
	}

	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if stored.Delay != 5 {
		t.Fatalf("delay = %d, want 5", stored.Delay)
	}
}

func TestJobChangePriority(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	job, err := q.Add(ctx, "normal", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := job.ChangePriority(ctx, 5, false); err != nil {
		t.Fatalf("ChangePriority: %v", err)
	}

	state, err := job.State(ctx)
	if err != nil {
		t.Fatalf("State: %v", err)
	}
	if state != bullmq.StatePrioritized {
		t.Fatalf("state = %q, want %q", state, bullmq.StatePrioritized)
	}
}

func TestJobStateReportsUnknownForMissingJobs(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	state, err := q.JobState(ctx, "does-not-exist")
	if err != nil {
		t.Fatalf("JobState: %v", err)
	}
	if state != bullmq.StateUnknown {
		t.Fatalf("state = %q, want %q", state, bullmq.StateUnknown)
	}
}

func TestJobRetryMovesAFailedJobBackToWait(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	failed := make(chan string, 1)
	w := newTestWorker(t, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
		return nil, errors.New("nope")
	}, nil)
	go func() {
		for ev := range w.Events() {
			if ev.Type == bullmq.EventFailed && ev.Job != nil {
				select {
				case failed <- ev.Job.ID:
				default:
				}
			}
		}
	}()
	runWorker(t, w)

	job, err := q.Add(ctx, "doomed", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	select {
	case <-failed:
	case <-time.After(10 * time.Second):
		t.Fatal("the job never failed")
	}

	if err := w.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if err := stored.Retry(ctx, bullmq.StateFailed); err != nil {
		t.Fatalf("Retry: %v", err)
	}

	state, err := q.JobState(ctx, job.ID)
	if err != nil {
		t.Fatalf("JobState: %v", err)
	}
	if state != bullmq.StateWaiting {
		t.Fatalf("state = %q, want %q", state, bullmq.StateWaiting)
	}
}

func TestJobIsCompletedAndIsFailed(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	w := newTestWorker(t, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
		if job.Name == "bad" {
			return nil, errors.New("bad job")
		}
		return "ok", nil
	}, nil)
	runWorker(t, w)

	good, err := q.Add(ctx, "good", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	bad, err := q.Add(ctx, "bad", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	waitFor(t, 10*time.Second, "both jobs to finish", func() bool {
		g, err := q.Job(ctx, good.ID)
		if err != nil || g == nil {
			return false
		}
		b, err := q.Job(ctx, bad.ID)
		if err != nil || b == nil {
			return false
		}
		gc, _ := g.IsCompleted(ctx)
		bf, _ := b.IsFailed(ctx)
		return gc && bf
	})

	stored, err := q.Job(ctx, good.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	var rv string
	if err := stored.DecodeReturnValue(&rv); err != nil {
		t.Fatalf("DecodeReturnValue: %v", err)
	}
	if rv != "ok" {
		t.Fatalf("return value = %q, want %q", rv, "ok")
	}

	failedJob, err := q.Job(ctx, bad.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if failedJob.FailedReason != "bad job" {
		t.Fatalf("FailedReason = %q, want %q", failedJob.FailedReason, "bad job")
	}
}
