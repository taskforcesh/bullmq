package bullmq_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// newManualWorker creates a worker without a processor, closed when the test
// ends.
func newManualWorker(t *testing.T, be testBackend, queueName string, opts *bullmq.WorkerOptions) *bullmq.Worker {
	t.Helper()
	w := newTestWorker(t, be, queueName, nil, opts)
	t.Cleanup(func() { _ = w.Close() })
	return w
}

// The manual loop of Node's guide: fetch a job, finish it, and get the next
// one from the finishing call, until the queue is empty.
func TestWorkerManualFetchLoop(t *testing.T) {
	forEachBackend(t, testWorkerManualFetchLoop)
}

func testWorkerManualFetchLoop(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	w := newManualWorker(t, be, q.Name(), &bullmq.WorkerOptions{DrainDelay: 300 * time.Millisecond})

	var cfg *bullmq.ConfigError
	if err := w.Run(ctx); !errors.As(err, &cfg) {
		t.Fatalf("Run without a processor = %v, want a ConfigError", err)
	}

	for i := range 4 {
		if _, err := q.Add(ctx, "ok", i, nil); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}
	bad, err := q.Add(ctx, "bad", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	flaky, err := q.Add(ctx, "flaky", nil, &bullmq.JobOptions{Attempts: bullmq.Int64(2)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	const token = "my-token"
	runs := map[string]int{}
	var job *bullmq.Job
	for range 20 {
		if job == nil {
			if job, err = w.GetNextJob(ctx, token, false); err != nil {
				t.Fatalf("GetNextJob: %v", err)
			}
			if job == nil {
				break
			}
		}
		if job.Token() != token {
			t.Fatalf("job token = %q, want %q", job.Token(), token)
		}
		runs[job.ID]++
		var next *bullmq.Job
		switch {
		case job.Name == "bad", job.Name == "flaky" && runs[job.ID] == 1:
			next, err = job.MoveToFailed(ctx, errors.New("boom"), token, true)
		case job.Name == "flaky":
			next, err = job.MoveToCompleted(ctx, "recovered", token, true)
		default:
			var n int
			if err := job.DecodeData(&n); err != nil {
				t.Fatalf("DecodeData: %v", err)
			}
			next, err = job.MoveToCompleted(ctx, n*10, token, true)
			if err == nil && (job.FinishedOn == 0 || string(job.ReturnValue) != fmt.Sprint(n*10)) {
				t.Fatalf("job after MoveToCompleted: finishedOn %d, return value %s", job.FinishedOn, job.ReturnValue)
			}
		}
		if err != nil {
			t.Fatalf("finishing %s: %v", job.Name, err)
		}
		job = next
	}

	counts, err := q.JobCounts(ctx, bullmq.StateCompleted, bullmq.StateFailed, bullmq.StateWaiting, bullmq.StateActive)
	if err != nil {
		t.Fatalf("JobCounts: %v", err)
	}
	if counts[bullmq.StateCompleted] != 5 || counts[bullmq.StateFailed] != 1 || counts[bullmq.StateWaiting] != 0 || counts[bullmq.StateActive] != 0 {
		t.Fatalf("counts = %v, want 5 completed and 1 failed", counts)
	}
	if runs[flaky.ID] != 2 || runs[bad.ID] != 1 {
		t.Fatalf("runs = %v, want the flaky job twice and the bad one once", runs)
	}
	stored, err := q.Job(ctx, bad.ID)
	if err != nil || stored == nil || stored.FailedReason != "boom" || stored.AttemptsMade != 1 {
		t.Fatalf("failed job = %+v, %v; want failed with boom after 1 attempt", stored, err)
	}

	// An empty queue: a blocking call waits up to DrainDelay.
	start := time.Now()
	if job, err := w.GetNextJob(ctx, token, true); err != nil || job != nil {
		t.Fatalf("GetNextJob on an empty queue = %v, %v; want nil", job, err)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("GetNextJob blocked for %v, want about DrainDelay", elapsed)
	}

	// A paused worker fetches nothing.
	if _, err := q.Add(ctx, "ok", 9, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := w.Pause(ctx, false); err != nil {
		t.Fatalf("Pause: %v", err)
	}
	if job, err := w.GetNextJob(ctx, token, false); err != nil || job != nil {
		t.Fatalf("GetNextJob while paused = %v, %v; want nil", job, err)
	}
	w.Resume()
	job, err = w.GetNextJob(ctx, token, false)
	if err != nil || job == nil {
		t.Fatalf("GetNextJob after Resume = %v, %v; want the job", job, err)
	}
	if next, err := job.MoveToCompleted(ctx, nil, token, false); err != nil || next != nil {
		t.Fatalf("MoveToCompleted without fetchNext = %v, %v; want nil", next, err)
	}

	// Only jobs fetched by a worker are finished by hand.
	stored, err = q.Job(ctx, flaky.ID)
	if err != nil || stored == nil {
		t.Fatalf("Job = %v, %v", stored, err)
	}
	if _, err := stored.MoveToCompleted(ctx, nil, token, false); !errors.As(err, &cfg) {
		t.Fatalf("MoveToCompleted of a job read from the queue = %v, want a ConfigError", err)
	}
}

// A blocking GetNextJob returns as soon as a job is added, and Close
// interrupts it.
func TestWorkerManualGetNextJobBlocks(t *testing.T) {
	forEachBackend(t, testWorkerManualGetNextJobBlocks)
}

func testWorkerManualGetNextJobBlocks(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	w := newManualWorker(t, be, q.Name(), &bullmq.WorkerOptions{DrainDelay: 10 * time.Second})

	type fetched struct {
		job *bullmq.Job
		err error
	}
	got := make(chan fetched, 1)
	// The first call finds the queue empty and waits for a job.
	go func() {
		job, err := w.GetNextJob(ctx, "t1", true)
		got <- fetched{job, err}
	}()
	time.Sleep(300 * time.Millisecond)
	added, err := q.Add(ctx, "late", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	select {
	case f := <-got:
		if f.err != nil || f.job == nil || f.job.ID != added.ID {
			t.Fatalf("GetNextJob = %v, %v; want job %s", f.job, f.err, added.ID)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("GetNextJob did not return when a job was added")
	}

	go func() {
		job, err := w.GetNextJob(ctx, "t2", true)
		got <- fetched{job, err}
	}()
	time.Sleep(300 * time.Millisecond)
	if err := w.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	select {
	case f := <-got:
		if !errors.Is(f.err, bullmq.ErrWorkerClosed) {
			t.Fatalf("GetNextJob interrupted by Close = %v, %v; want ErrWorkerClosed", f.job, f.err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Close did not interrupt GetNextJob")
	}
	if _, err := w.GetNextJob(ctx, "t3", false); !errors.Is(err, bullmq.ErrWorkerClosed) {
		t.Fatalf("GetNextJob after Close = %v, want ErrWorkerClosed", err)
	}
}

// A job fetched by hand keeps its lock while it is extended, and the stalled
// check leaves it alone.
func TestWorkerManualLockExtension(t *testing.T) {
	forEachBackend(t, testWorkerManualLockExtension)
}

func testWorkerManualLockExtension(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	w := newManualWorker(t, be, q.Name(), &bullmq.WorkerOptions{
		LockDuration:    time.Second,
		StalledInterval: 300 * time.Millisecond,
	})
	if err := w.StartStalledCheck(); err != nil {
		t.Fatalf("StartStalledCheck: %v", err)
	}
	added, err := q.Add(ctx, "long", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	const token = "long-token"
	job, err := w.GetNextJob(ctx, token, false)
	if err != nil || job == nil || job.ID != added.ID {
		t.Fatalf("GetNextJob = %v, %v; want job %s", job, err, added.ID)
	}

	for deadline := time.Now().Add(2500 * time.Millisecond); time.Now().Before(deadline); {
		if err := job.ExtendLock(ctx, time.Second); err != nil {
			t.Fatalf("ExtendLock: %v", err)
		}
		time.Sleep(300 * time.Millisecond)
		if state, err := q.JobState(ctx, job.ID); err != nil || state != bullmq.StateActive {
			t.Fatalf("state while the lock is extended = %s, %v; want active", state, err)
		}
	}
	if _, err := job.MoveToCompleted(ctx, "done", token, false); err != nil {
		t.Fatalf("MoveToCompleted: %v", err)
	}
	stored, err := q.Job(ctx, job.ID)
	if err != nil || stored == nil || stored.StalledCounter != 0 {
		t.Fatalf("stored job = %+v, %v; want it never stalled", stored, err)
	}
}

// A job fetched by hand whose lock isn't extended stalls: the stalled check
// moves it back to wait, and its token no longer finishes it.
func TestWorkerManualStalledJob(t *testing.T) {
	forEachBackend(t, testWorkerManualStalledJob)
}

func testWorkerManualStalledJob(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	w := newManualWorker(t, be, q.Name(), &bullmq.WorkerOptions{
		LockDuration:    500 * time.Millisecond,
		StalledInterval: 300 * time.Millisecond,
	})
	if err := w.StartStalledCheck(); err != nil {
		t.Fatalf("StartStalledCheck: %v", err)
	}
	if err := w.StartStalledCheck(); err != nil {
		t.Fatalf("second StartStalledCheck: %v", err)
	}
	added, err := q.Add(ctx, "forgotten", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	job, err := w.GetNextJob(ctx, "first", false)
	if err != nil || job == nil {
		t.Fatalf("GetNextJob = %v, %v; want the job", job, err)
	}

	waitFor(t, 10*time.Second, "the stalled check to move the job back to wait", func() bool {
		s, _ := q.JobState(ctx, added.ID)
		return s == bullmq.StateWaiting
	})
	stalled := false
	for !stalled {
		select {
		case ev := <-w.Events():
			stalled = ev.Type == bullmq.EventStalled && ev.Job != nil && ev.Job.ID == added.ID
		case <-time.After(5 * time.Second):
			t.Fatal("no EventStalled for the job")
		}
	}
	if _, err := job.MoveToCompleted(ctx, nil, "first", false); err == nil {
		t.Fatal("MoveToCompleted with the token of a stalled job succeeded")
	}

	again, err := w.GetNextJob(ctx, "second", false)
	if err != nil || again == nil || again.ID != added.ID {
		t.Fatalf("GetNextJob = %v, %v; want the stalled job again", again, err)
	}
	if again.StalledCounter != 1 {
		t.Fatalf("stalled counter = %d, want 1", again.StalledCounter)
	}
	if _, err := again.MoveToCompleted(ctx, nil, "second", false); err != nil {
		t.Fatalf("MoveToCompleted: %v", err)
	}
	if state, err := q.JobState(ctx, added.ID); err != nil || state != bullmq.StateCompleted {
		t.Fatalf("state = %s, %v; want completed", state, err)
	}
}

// StartStalledCheck is for workers without a processor.
func TestWorkerStartStalledCheckNeedsAManualWorker(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		q := newTestQueue(t, be, nil)
		w := newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) { return nil, nil }, nil)
		t.Cleanup(func() { _ = w.Close() })
		var cfg *bullmq.ConfigError
		if err := w.StartStalledCheck(); !errors.As(err, &cfg) {
			t.Fatalf("StartStalledCheck with a processor = %v, want a ConfigError", err)
		}
	})
}
