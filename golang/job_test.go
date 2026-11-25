package bullmq_test

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

func TestJobUpdateProgress(t *testing.T) {
	forEachBackend(t, testJobUpdateProgress)
}

func testJobUpdateProgress(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	job, err := q.Add(ctx, "progress", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	progress, err := bullmq.NumberProgress(50)
	if err != nil {
		t.Fatalf("NumberProgress: %v", err)
	}
	if err := job.UpdateProgress(ctx, progress); err != nil {
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

// UpdateProgress takes numbers of any type, and rejects NaN and infinite
// ones before reaching the datastore.
func TestJobUpdateProgressWithNumbers(t *testing.T) {
	forEachBackend(t, testJobUpdateProgressWithNumbers)
}

func testJobUpdateProgressWithNumbers(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	job, err := q.Add(ctx, "progress", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	for _, v := range []any{42, int64(43), uint8(44), 45.5, float32(46.5)} {
		if err := job.UpdateProgress(ctx, v); err != nil {
			t.Fatalf("UpdateProgress(%T %v): %v", v, v, err)
		}
	}
	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if n, ok := stored.Progress.Number(); !ok || n != 46.5 {
		t.Fatalf("progress = %v (%v), want 46.5", n, ok)
	}

	var cfg *bullmq.ConfigError
	for _, v := range []any{math.NaN(), math.Inf(1), float32(math.Inf(-1)), map[string]float64{"pct": math.NaN()}} {
		if err := job.UpdateProgress(ctx, v); !errors.As(err, &cfg) {
			t.Fatalf("UpdateProgress(%v) = %v, want a ConfigError", v, err)
		}
	}
	if n, ok := job.Progress.Number(); !ok || n != 46.5 {
		t.Fatalf("Job.Progress after rejected updates = %s, want 46.5", job.Progress.Raw())
	}
}

func TestJobUpdateProgressWithAStruct(t *testing.T) {
	forEachBackend(t, testJobUpdateProgressWithAStruct)
}

func testJobUpdateProgressWithAStruct(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	job, err := q.Add(ctx, "progress", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	type step struct {
		Step string `json:"step"`
		Pct  int    `json:"pct"`
	}
	if err := job.UpdateProgress(ctx, step{Step: "upload", Pct: 10}); err != nil {
		t.Fatalf("UpdateProgress: %v", err)
	}
	var local step
	if err := job.Progress.Decode(&local); err != nil || local.Step != "upload" {
		t.Fatalf("Job.Progress = %s (%v), want the new value", job.Progress.Raw(), err)
	}

	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	var out step
	if err := stored.Progress.Decode(&out); err != nil {
		t.Fatalf("Decode: %v", err)
	}
	if out.Step != "upload" || out.Pct != 10 {
		t.Fatalf("progress = %+v", out)
	}
}

func TestJobUpdateData(t *testing.T) {
	forEachBackend(t, testJobUpdateData)
}

func testJobUpdateData(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

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
	forEachBackend(t, testJobLogs)
}

func testJobLogs(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

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
	forEachBackend(t, testJobRemove)
}

func testJobRemove(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

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
	forEachBackend(t, testJobPromote)
}

func testJobPromote(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	job, err := q.Add(ctx, "delayed", nil, &bullmq.JobOptions{Delay: bullmq.Int64(600_000)})
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
	forEachBackend(t, testJobChangeDelay)
}

func testJobChangeDelay(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	job, err := q.Add(ctx, "delayed", nil, &bullmq.JobOptions{Delay: bullmq.Int64(600_000)})
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
	forEachBackend(t, testJobChangePriority)
}

func testJobChangePriority(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

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
	forEachBackend(t, testJobStateReportsUnknownForMissingJobs)
}

func testJobStateReportsUnknownForMissingJobs(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	state, err := q.JobState(ctx, "does-not-exist")
	if err != nil {
		t.Fatalf("JobState: %v", err)
	}
	if state != bullmq.StateUnknown {
		t.Fatalf("state = %q, want %q", state, bullmq.StateUnknown)
	}
}

func TestJobRetryMovesAFailedJobBackToWait(t *testing.T) {
	forEachBackend(t, testJobRetryMovesAFailedJobBackToWait)
}

func testJobRetryMovesAFailedJobBackToWait(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	failed := make(chan string, 1)
	w := newTestWorker(t, be, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
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
	if err := stored.Retry(ctx, bullmq.StateFailed, nil); err != nil {
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

func TestJobRetryMovesAFailedPriorityJobBackToPrioritized(t *testing.T) {
	forEachBackend(t, testJobRetryMovesAFailedPriorityJobBackToPrioritized)
}

func testJobRetryMovesAFailedPriorityJobBackToPrioritized(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	failed := make(chan string, 1)
	w := newTestWorker(t, be, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
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

	job, err := q.Add(ctx, "doomed", nil, &bullmq.JobOptions{Priority: bullmq.Int64(1)})
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
	if err := stored.Retry(ctx, bullmq.StateFailed, nil); err != nil {
		t.Fatalf("Retry: %v", err)
	}

	state, err := q.JobState(ctx, job.ID)
	if err != nil {
		t.Fatalf("JobState: %v", err)
	}
	if state != bullmq.StatePrioritized {
		t.Fatalf("state = %q, want %q", state, bullmq.StatePrioritized)
	}
}

func TestJobIsCompletedAndIsFailed(t *testing.T) {
	forEachBackend(t, testJobIsCompletedAndIsFailed)
}

func testJobIsCompletedAndIsFailed(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	w := newTestWorker(t, be, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
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

// A Job built by the caller has no backend, so the methods that reach the
// datastore report ErrNoContext, whose message names the actual problem.
func TestJobWithoutBackendReportsErrNoContext(t *testing.T) {
	ctx := context.Background()
	job := &bullmq.Job{ID: "1", Name: "unit"}
	if _, err := job.Log(ctx, "row"); !errors.Is(err, bullmq.ErrNoContext) {
		t.Errorf("Log = %v, want ErrNoContext", err)
	}
	if _, err := job.State(ctx); !errors.Is(err, bullmq.ErrNoContext) {
		t.Errorf("State = %v, want ErrNoContext", err)
	}
	if err := job.UpdateData(ctx, "x"); !errors.Is(err, bullmq.ErrNoContext) {
		t.Errorf("UpdateData = %v, want ErrNoContext", err)
	}
	if got, want := bullmq.ErrNoContext.Error(), "bullmq: job has no backend"; got != want {
		t.Errorf("ErrNoContext = %q, want %q", got, want)
	}
}
