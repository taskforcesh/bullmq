package bullmq_test

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq/golang"
)

func TestWorkerProcessesJobs(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	processed := make(chan string, 1)
	w := newTestWorker(t, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
		var payload map[string]string
		if err := job.DecodeData(&payload); err != nil {
			return nil, err
		}
		processed <- payload["msg"]
		return map[string]bool{"ok": true}, nil
	}, nil)
	runWorker(t, w)

	job, err := q.Add(ctx, "hello", map[string]string{"msg": "hi"}, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	select {
	case msg := <-processed:
		if msg != "hi" {
			t.Fatalf("payload = %q, want %q", msg, "hi")
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the job was never processed")
	}

	waitFor(t, 10*time.Second, "the job to be completed", func() bool {
		state, err := q.JobState(ctx, job.ID)
		return err == nil && state == bullmq.StateCompleted
	})

	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	var rv map[string]bool
	if err := stored.DecodeReturnValue(&rv); err != nil {
		t.Fatalf("DecodeReturnValue: %v", err)
	}
	if !rv["ok"] {
		t.Fatalf("return value = %v", rv)
	}
	if stored.ProcessedOn == 0 || stored.FinishedOn == 0 {
		t.Errorf("timestamps were not recorded: processedOn=%d finishedOn=%d",
			stored.ProcessedOn, stored.FinishedOn)
	}
}

func TestWorkerCollectsCompletedMetrics(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	w := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		return nil, nil
	}, &bullmq.WorkerOptions{Metrics: &bullmq.MetricsOptions{MaxDataPoints: 10}})
	runWorker(t, w)

	job, err := q.Add(ctx, "hello", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	waitFor(t, 10*time.Second, "the job to be completed", func() bool {
		state, err := q.JobState(ctx, job.ID)
		return err == nil && state == bullmq.StateCompleted
	})

	metrics, err := q.Metrics(ctx, bullmq.StateCompleted, 0, -1)
	if err != nil {
		t.Fatalf("Metrics: %v", err)
	}
	// The data list only gains a point once a one-minute boundary has passed
	// since the first recorded job, so with a single job in the same minute
	// only Count (and the initialized PrevTS) are observable here.
	if metrics.Count != 1 {
		t.Errorf("Count = %d, want 1", metrics.Count)
	}
}

func TestWorkerProcessesJobsInOrder(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	const total = 10
	var mu sync.Mutex
	seen := make([]string, 0, total)
	done := make(chan struct{})

	w := newTestWorker(t, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
		mu.Lock()
		seen = append(seen, job.Name)
		if len(seen) == total {
			close(done)
		}
		mu.Unlock()
		return nil, nil
	}, nil)
	runWorker(t, w)

	for i := range total {
		if _, err := q.Add(ctx, string(rune('a'+i)), nil, nil); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}

	select {
	case <-done:
	case <-time.After(20 * time.Second):
		t.Fatalf("only %d of %d jobs were processed", len(seen), total)
	}

	mu.Lock()
	defer mu.Unlock()
	for i, name := range seen {
		if want := string(rune('a' + i)); name != want {
			t.Fatalf("job %d = %q, want %q (FIFO order)", i, name, want)
		}
	}
}

func TestWorkerRespectsConcurrency(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	var inFlight, peak atomic.Int64
	done := make(chan struct{})
	var processed atomic.Int64

	w := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		current := inFlight.Add(1)
		for {
			old := peak.Load()
			if current <= old || peak.CompareAndSwap(old, current) {
				break
			}
		}
		time.Sleep(80 * time.Millisecond)
		inFlight.Add(-1)
		if processed.Add(1) == 8 {
			close(done)
		}
		return nil, nil
	}, &bullmq.WorkerOptions{Concurrency: 4})
	runWorker(t, w)

	for range 8 {
		if _, err := q.Add(ctx, "concurrent", nil, nil); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}

	select {
	case <-done:
	case <-time.After(20 * time.Second):
		t.Fatal("the jobs were never processed")
	}

	if got := peak.Load(); got > 4 {
		t.Fatalf("peak concurrency = %d, want at most 4", got)
	}
	if got := peak.Load(); got < 2 {
		t.Fatalf("peak concurrency = %d, the jobs did not run in parallel", got)
	}
}

func TestWorkerRetriesFailedJobs(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	var attempts atomic.Int64
	succeeded := make(chan struct{})
	w := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		if attempts.Add(1) < 3 {
			return nil, errors.New("transient")
		}
		close(succeeded)
		return nil, nil
	}, nil)
	runWorker(t, w)

	job, err := q.Add(ctx, "flaky", nil, &bullmq.JobOptions{
		Attempts: bullmq.Int64(3),
		Backoff:  &bullmq.Backoff{Type: bullmq.BackoffFixed, Delay: 10},
	})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	select {
	case <-succeeded:
	case <-time.After(20 * time.Second):
		t.Fatalf("the job was retried %d times but never succeeded", attempts.Load())
	}

	waitFor(t, 10*time.Second, "the job to be completed", func() bool {
		state, err := q.JobState(ctx, job.ID)
		return err == nil && state == bullmq.StateCompleted
	})

	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if stored.AttemptsMade != 3 {
		t.Errorf("AttemptsMade = %d, want 3", stored.AttemptsMade)
	}
}

func TestWorkerFailsAfterExhaustingAttempts(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	var attempts atomic.Int64
	w := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		attempts.Add(1)
		return nil, errors.New("always fails")
	}, nil)
	runWorker(t, w)

	job, err := q.Add(ctx, "doomed", nil, &bullmq.JobOptions{Attempts: bullmq.Int64(2)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	waitFor(t, 20*time.Second, "the job to fail permanently", func() bool {
		state, err := q.JobState(ctx, job.ID)
		return err == nil && state == bullmq.StateFailed
	})

	if got := attempts.Load(); got != 2 {
		t.Errorf("the processor ran %d times, want 2", got)
	}
	stored, err := q.Job(ctx, job.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	if stored.FailedReason != "always fails" {
		t.Errorf("FailedReason = %q", stored.FailedReason)
	}
}

func TestWorkerDoesNotRetryUnrecoverableErrors(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	var attempts atomic.Int64
	w := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		attempts.Add(1)
		return nil, bullmq.NewUnrecoverableError("bad input")
	}, nil)
	runWorker(t, w)

	job, err := q.Add(ctx, "unrecoverable", nil, &bullmq.JobOptions{Attempts: bullmq.Int64(5)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	waitFor(t, 20*time.Second, "the job to fail", func() bool {
		state, err := q.JobState(ctx, job.ID)
		return err == nil && state == bullmq.StateFailed
	})
	time.Sleep(300 * time.Millisecond)

	if got := attempts.Load(); got != 1 {
		t.Errorf("the processor ran %d times, want 1", got)
	}
}

func TestWorkerRecoversFromAPanic(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	w := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		panic("boom")
	}, nil)
	runWorker(t, w)

	job, err := q.Add(ctx, "panics", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	waitFor(t, 20*time.Second, "the panicking job to fail", func() bool {
		state, err := q.JobState(ctx, job.ID)
		return err == nil && state == bullmq.StateFailed
	})
}

func TestWorkerEmitsEvents(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	w := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		return "done", nil
	}, nil)

	var mu sync.Mutex
	seen := map[bullmq.EventType]int{}
	go func() {
		for ev := range w.Events() {
			mu.Lock()
			seen[ev.Type]++
			mu.Unlock()
		}
	}()
	runWorker(t, w)

	if _, err := q.Add(ctx, "evented", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}

	waitFor(t, 10*time.Second, "the active and completed events", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return seen[bullmq.EventActive] > 0 && seen[bullmq.EventCompleted] > 0
	})
}

func TestWorkerEmitsProgressEvent(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	w := newTestWorker(t, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		progress, err := bullmq.NumberProgress(42)
		if err != nil {
			return nil, err
		}
		if err := job.UpdateProgress(ctx, progress); err != nil {
			return nil, err
		}
		return nil, nil
	}, nil)

	var mu sync.Mutex
	var progress []any
	go func() {
		for ev := range w.Events() {
			if ev.Type == bullmq.EventProgress {
				mu.Lock()
				progress = append(progress, ev.Result)
				mu.Unlock()
			}
		}
	}()
	runWorker(t, w)

	if _, err := q.Add(ctx, "progressed", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}

	waitFor(t, 10*time.Second, "the progress event", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(progress) > 0
	})

	mu.Lock()
	defer mu.Unlock()
	prog, ok := progress[0].(bullmq.Progress)
	if !ok {
		t.Fatalf("Result = %T, want bullmq.Progress", progress[0])
	}
	n, ok := prog.Number()
	if !ok || n != 42 {
		t.Errorf("Progress = %v, %v, want 42, true", n, ok)
	}
}

func TestWorkerRemoveOnComplete(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	done := make(chan struct{}, 1)
	w := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		done <- struct{}{}
		return nil, nil
	}, nil)
	runWorker(t, w)

	job, err := q.Add(ctx, "ephemeral", nil, &bullmq.JobOptions{
		RemoveOnComplete: bullmq.RemoveAll(),
	})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	<-done

	waitFor(t, 10*time.Second, "the job to be removed", func() bool {
		stored, err := q.Job(ctx, job.ID)
		return err == nil && stored == nil
	})
}

func TestWorkerPauseAndResume(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	var processed atomic.Int64
	w := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		processed.Add(1)
		return nil, nil
	}, nil)
	runWorker(t, w)

	w.Pause()
	if !w.IsPaused() {
		t.Fatal("the worker should be paused")
	}
	if _, err := q.Add(ctx, "while-paused", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	time.Sleep(700 * time.Millisecond)
	if got := processed.Load(); got != 0 {
		t.Fatalf("the paused worker processed %d jobs", got)
	}

	w.Resume()
	waitFor(t, 10*time.Second, "the job to be processed after resuming", func() bool {
		return processed.Load() == 1
	})
}

func TestWorkerHonoursTheRateLimiter(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	var processed atomic.Int64
	w := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		processed.Add(1)
		return nil, nil
	}, &bullmq.WorkerOptions{
		Limiter: &bullmq.RateLimiter{Max: 2, Duration: 5 * time.Second},
	})
	runWorker(t, w)

	for range 5 {
		if _, err := q.Add(ctx, "limited", nil, nil); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}

	waitFor(t, 10*time.Second, "the first batch to be processed", func() bool {
		return processed.Load() >= 2
	})
	time.Sleep(700 * time.Millisecond)
	if got := processed.Load(); got > 2 {
		t.Fatalf("the rate limiter allowed %d jobs in the first window, want 2", got)
	}
}

func TestWorkerProcessesDelayedJobs(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	processed := make(chan time.Time, 1)
	w := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		processed <- time.Now()
		return nil, nil
	}, nil)
	runWorker(t, w)

	start := time.Now()
	if _, err := q.Add(ctx, "later", nil, &bullmq.JobOptions{Delay: bullmq.Int64(400)}); err != nil {
		t.Fatalf("Add: %v", err)
	}

	select {
	case at := <-processed:
		if elapsed := at.Sub(start); elapsed < 300*time.Millisecond {
			t.Fatalf("the delayed job ran after %s, too early", elapsed)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("the delayed job was never processed")
	}
}

func TestWorkerMoveToDelayedFromTheProcessor(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	var runs atomic.Int64
	completed := make(chan struct{})
	w := newTestWorker(t, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		if runs.Add(1) == 1 {
			if err := job.MoveToDelayed(ctx, 200*time.Millisecond); err != nil {
				return nil, err
			}
			return nil, bullmq.ErrDelayed
		}
		close(completed)
		return nil, nil
	}, nil)
	runWorker(t, w)

	if _, err := q.Add(ctx, "reschedules", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}

	select {
	case <-completed:
	case <-time.After(15 * time.Second):
		t.Fatal("the rescheduled job was never processed again")
	}
}

func TestWorkerRecoversStalledJobs(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	// The first worker takes the job and then hangs forever without renewing
	// its lock, so the job ends up stalled in the active list.
	stuck := make(chan struct{})
	hang := make(chan struct{})

	stalling := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		close(stuck)
		<-hang
		return nil, nil
	}, &bullmq.WorkerOptions{
		LockDuration:     1 * time.Second,
		SkipLockRenewal:  true,
		SkipStalledCheck: true,
	})
	stallingCtx, cancelStalling := context.WithCancel(context.Background())
	t.Cleanup(func() {
		// close(hang) must run before stalling.Close(), since Close waits for
		// the in-flight processor (blocked on <-hang) to return. Cleanups run
		// LIFO, so both steps are combined into this single cleanup rather
		// than registered separately, where the order would be reversed.
		close(hang)
		cancelStalling()
		_ = stalling.Close()
	})
	go func() { _ = stalling.Run(stallingCtx) }()

	if _, err := q.Add(ctx, "stalls", nil, &bullmq.JobOptions{Attempts: bullmq.Int64(3)}); err != nil {
		t.Fatalf("Add: %v", err)
	}
	select {
	case <-stuck:
	case <-time.After(10 * time.Second):
		t.Fatal("the first worker never picked up the job")
	}

	// A second worker with a fast stalled check recovers it.
	recovered := make(chan struct{})
	rescuer := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		close(recovered)
		return nil, nil
	}, &bullmq.WorkerOptions{
		LockDuration:    1 * time.Second,
		StalledInterval: 500 * time.Millisecond,
	})
	runWorker(t, rescuer)

	select {
	case <-recovered:
	case <-time.After(30 * time.Second):
		t.Fatal("the stalled job was never recovered")
	}
}

func TestWorkerCloseKeepsRenewingLocksOfInFlightJobs(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	// The processor sleeps well past LockDuration; if lock renewal stops as
	// soon as Close is called (rather than once the job actually finishes),
	// the lock expires and a stalled-check could hand the job to another
	// worker while this processor is still running.
	started := make(chan struct{})
	var invocations atomic.Int64
	release := make(chan struct{})

	w := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		invocations.Add(1)
		close(started)
		<-release
		return nil, nil
	}, &bullmq.WorkerOptions{
		LockDuration:    500 * time.Millisecond,
		LockRenewTime:   150 * time.Millisecond,
		StalledInterval: 200 * time.Millisecond,
	})

	runCtx, cancelRun := context.WithCancel(context.Background())
	defer cancelRun()
	go func() { _ = w.Run(runCtx) }()

	if _, err := q.Add(ctx, "long-running", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}

	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("the job was never picked up")
	}

	closeDone := make(chan error, 1)
	go func() { closeDone <- w.Close() }()

	// Give lock renewal and any stalled check several opportunities to run
	// while the processor is still sleeping, well beyond LockDuration.
	time.Sleep(2 * time.Second)
	close(release)

	select {
	case err := <-closeDone:
		if err != nil {
			t.Fatalf("Close: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("Close did not return")
	}

	if got := invocations.Load(); got != 1 {
		t.Errorf("the processor ran %d times, want 1 (the job must not have been picked up again)", got)
	}
}

func TestWorkerRenewsLocksOfAllActiveJobsInOneBatch(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	const total = 5
	var invocations atomic.Int64
	release := make(chan struct{})

	// The jobs outlive LockDuration several times over and the stalled check
	// runs more often than the lock TTL, so any job whose lock is not renewed
	// in time would be picked up (and processed) a second time.
	w := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		invocations.Add(1)
		<-release
		return nil, nil
	}, &bullmq.WorkerOptions{
		Concurrency:     total,
		LockDuration:    300 * time.Millisecond,
		LockRenewTime:   50 * time.Millisecond,
		StalledInterval: 100 * time.Millisecond,
	})
	runWorker(t, w)
	// Registered after runWorker so it runs first: the processors block on
	// release, and the worker cannot stop until they return.
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })

	for range total {
		if _, err := q.Add(ctx, "held", nil, nil); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}

	waitFor(t, 10*time.Second, "all jobs to become active", func() bool {
		return w.ActiveCount() == total
	})
	time.Sleep(1500 * time.Millisecond)

	if got := invocations.Load(); got != total {
		t.Fatalf("the processor ran %d times, want %d (a lock expired and a job was re-run)", got, total)
	}
	if got := w.ActiveCount(); got != total {
		t.Fatalf("ActiveCount = %d, want %d", got, total)
	}
	releaseOnce.Do(func() { close(release) })
}

func TestWorkerCancelsOnlyTheJobWhoseLockWasLost(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, nil)

	const total = 3
	var mu sync.Mutex
	ctxs := map[string]context.Context{}
	release := make(chan struct{})

	w := newTestWorker(t, q.Name(), func(jobCtx context.Context, job *bullmq.Job) (any, error) {
		mu.Lock()
		ctxs[job.ID] = jobCtx
		mu.Unlock()
		<-release
		return nil, nil
	}, &bullmq.WorkerOptions{
		Concurrency:      total,
		LockDuration:     1 * time.Second,
		LockRenewTime:    50 * time.Millisecond,
		SkipStalledCheck: true,
	})

	stalled := make(chan string, total)
	go func() {
		for ev := range w.Events() {
			if ev.Type == bullmq.EventStalled && ev.Job != nil {
				stalled <- ev.Job.ID
			}
		}
	}()
	runWorker(t, w)
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(release) }) })

	for range total {
		if _, err := q.Add(ctx, "held", nil, nil); err != nil {
			t.Fatalf("Add: %v", err)
		}
	}
	waitFor(t, 10*time.Second, "all jobs to become active", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(ctxs) == total
	})

	// Drop one job's lock, simulating another worker taking it over.
	var lostID string
	mu.Lock()
	for id := range ctxs {
		lostID = id
		break
	}
	mu.Unlock()
	if err := q.Client().Del(ctx, q.Keys().JobLock(lostID)).Err(); err != nil {
		t.Fatalf("Del: %v", err)
	}

	select {
	case id := <-stalled:
		if id != lostID {
			t.Fatalf("EventStalled for job %s, want %s", id, lostID)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("no EventStalled for the job whose lock was lost")
	}

	mu.Lock()
	defer mu.Unlock()
	select {
	case <-ctxs[lostID].Done():
	case <-time.After(5 * time.Second):
		t.Fatal("the job whose lock was lost was not cancelled")
	}
	for id, c := range ctxs {
		if id != lostID && c.Err() != nil {
			t.Fatalf("job %s was cancelled although its lock is intact", id)
		}
	}
}

func TestWorkerCloseIsIdempotent(t *testing.T) {
	requireRedis(t)
	q := newTestQueue(t, nil)

	w := newTestWorker(t, q.Name(), func(_ context.Context, _ *bullmq.Job) (any, error) {
		return nil, nil
	}, nil)
	ctx, cancel := context.WithCancel(context.Background())
	go func() { _ = w.Run(ctx) }()
	time.Sleep(200 * time.Millisecond)
	cancel()

	for range 3 {
		if err := w.Close(); err != nil {
			t.Fatalf("Close: %v", err)
		}
	}
}
