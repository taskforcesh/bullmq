package bullmq_test

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// A busy worker fetches each next job while finishing the current one, in
// every slot, re-using the slot's lock token, so it needs about one backend
// call per job instead of a separate fetch.
func TestWorkerChainsFetchNextInEverySlot(t *testing.T) {
	forEachBackend(t, testWorkerChainsFetchNextInEverySlot)
}

func testWorkerChainsFetchNextInEverySlot(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	const total, concurrency = 60, 3
	specs := make([]bullmq.JobSpec, total)
	for i := range specs {
		specs[i] = bullmq.JobSpec{Name: "chained", Data: i}
	}
	if _, err := q.AddBulk(ctx, specs); err != nil {
		t.Fatalf("AddBulk: %v", err)
	}

	hooks := &backendHooks{}
	var processed atomic.Int64
	w := newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) {
		processed.Add(1)
		time.Sleep(2 * time.Millisecond)
		return nil, nil
	}, &bullmq.WorkerOptions{Backend: hooks.wrap(be.Factory), Concurrency: concurrency})
	runWorker(t, w)

	waitFor(t, 20*time.Second, "all jobs to complete", func() bool {
		counts, err := q.JobCounts(ctx, bullmq.StateCompleted)
		return err == nil && counts[bullmq.StateCompleted] == total
	})

	// The loop fills the slots once (plus the fetches that find the queue
	// drained at the end); every other job comes from a finishing call.
	if got := hooks.moveToActive.Load(); got > 2*concurrency+2 {
		t.Errorf("MoveToActive calls = %d for %d jobs at concurrency %d, want at most %d",
			got, total, concurrency, 2*concurrency+2)
	}
	if got := hooks.fetchNext.Load(); got < total-concurrency {
		t.Errorf("finishes with fetch-next = %d, want at least %d", got, total-concurrency)
	}
	// A slot keeps its token, so chained jobs are finished with as many
	// tokens as there were fetches into free slots.
	if got, fetched := int64(hooks.finishTokens()), hooks.moveToActive.Load(); got > fetched {
		t.Errorf("jobs were finished with %d distinct tokens, more than the %d fetches into free slots", got, fetched)
	}
	if got := processed.Load(); got != total {
		t.Errorf("processed %d jobs, want %d", got, total)
	}
}

// A slot that finishes without asking for the next job (here, because the
// worker was paused) learns nothing about the queue, so it must not report
// it drained.
func TestWorkerDoesNotReportDrainedAfterAFinishWithoutFetchNext(t *testing.T) {
	forEachBackend(t, testWorkerDoesNotReportDrainedAfterAFinishWithoutFetchNext)
}

func testWorkerDoesNotReportDrainedAfterAFinishWithoutFetchNext(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	addJobs(t, ctx, q, 2)

	var w *bullmq.Worker
	var processed atomic.Int64
	w = newTestWorker(t, be, q.Name(), func(ctx context.Context, _ *bullmq.Job) (any, error) {
		if processed.Add(1) == 1 {
			if err := w.Pause(ctx, true); err != nil {
				return nil, err
			}
		}
		return nil, nil
	}, nil)
	var log eventLog
	log.collect(w)
	runWorker(t, w)

	waitFor(t, 10*time.Second, "the first job to complete", func() bool {
		counts, err := q.JobCounts(ctx, bullmq.StateCompleted)
		return err == nil && counts[bullmq.StateCompleted] == 1
	})
	time.Sleep(300 * time.Millisecond)
	if n := log.count(bullmq.EventDrained); n != 0 {
		t.Fatalf("EventDrained emitted %d times while a job was still waiting", n)
	}

	w.Resume()
	waitFor(t, 10*time.Second, "the second job to complete", func() bool {
		return processed.Load() == 2
	})
}

// A rate-limited worker sleeps the limit out instead of fetching or blocking
// on the queue every time a job is added.
func TestWorkerSleepsOutTheRateLimitWhileJobsAreAdded(t *testing.T) {
	forEachBackend(t, testWorkerSleepsOutTheRateLimitWhileJobsAreAdded)
}

func testWorkerSleepsOutTheRateLimitWhileJobsAreAdded(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	hooks := &backendHooks{}
	var processed atomic.Int64
	w := newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) {
		processed.Add(1)
		return nil, nil
	}, &bullmq.WorkerOptions{
		Backend: hooks.wrap(be.Factory),
		Limiter: &bullmq.RateLimiter{Max: 1, Duration: time.Second},
	})
	runWorker(t, w)

	// About 200 jobs/s for 2.5s.
	deadline := time.Now().Add(2500 * time.Millisecond)
	added := 0
	for time.Now().Before(deadline) {
		if _, err := q.Add(ctx, "limited", nil, nil); err != nil {
			t.Fatalf("Add: %v", err)
		}
		added++
		time.Sleep(5 * time.Millisecond)
	}

	jobs := processed.Load()
	fetches, waits := hooks.fetches(), hooks.waits.Load()
	t.Logf("added %d jobs, processed %d, fetches %d, waits %d", added, jobs, fetches, waits)
	if jobs < 2 || jobs > 4 {
		t.Errorf("processed %d jobs in 2.5s with a limit of 1 per second", jobs)
	}
	// Two fetches per window (the one that gets the job and the finish that
	// reports the limit) plus a few around the start.
	if fetches > 3*jobs+6 {
		t.Errorf("%d fetches for %d jobs: the worker did not sleep out the rate limit", fetches, jobs)
	}
	if waits > 3 {
		t.Errorf("%d waits on the queue while rate limited, want at most 3", waits)
	}
}

// The rate limit sleep is capped by MaximumRateLimitDelay, so the worker
// fetches again (and promotes delayed jobs) during a long limit.
func TestWorkerCapsTheRateLimitSleep(t *testing.T) {
	forEachBackend(t, testWorkerCapsTheRateLimitSleep)
}

func testWorkerCapsTheRateLimitSleep(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	addJobs(t, ctx, q, 2)

	hooks := &backendHooks{}
	var processed atomic.Int64
	w := newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) {
		processed.Add(1)
		return nil, nil
	}, &bullmq.WorkerOptions{
		Backend:               hooks.wrap(be.Factory),
		Limiter:               &bullmq.RateLimiter{Max: 1, Duration: time.Minute},
		MaximumRateLimitDelay: 200 * time.Millisecond,
	})
	runWorker(t, w)

	time.Sleep(1100 * time.Millisecond)
	if got := processed.Load(); got != 1 {
		t.Fatalf("processed %d jobs under a limit of 1 per minute, want 1", got)
	}
	// One fetch for the job, one finish reporting the limit, then one fetch
	// per capped sleep.
	if got := hooks.fetches(); got < 4 || got > 9 {
		t.Errorf("fetches = %d in 1.1s with sleeps capped at 200ms, want 4 to 9", got)
	}
}

// When the next job fetched by moving a failed job to delayed is missing,
// the worker fetches again: the queue is not necessarily drained.
func TestWorkerFetchesAgainWhenMoveToDelayedBringsNoJob(t *testing.T) {
	forEachBackend(t, testWorkerFetchesAgainWhenMoveToDelayedBringsNoJob)
}

func testWorkerFetchesAgainWhenMoveToDelayedBringsNoJob(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	retried, err := q.Add(ctx, "retried", nil, &bullmq.JobOptions{
		Attempts: bullmq.Int64(2),
		Backoff:  &bullmq.Backoff{Type: bullmq.BackoffFixed, Delay: 60_000},
	})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if _, err := q.Add(ctx, "next", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}

	// Backends may report only a fetched job from MoveToDelayed; simulate one
	// that never does.
	hooks := &backendHooks{
		onMoveToDelayed: func(ctx context.Context, b bullmq.Backend, jobID, token string, delay time.Duration, opts bullmq.MoveToDelayedOptions) (*bullmq.FetchResult, error) {
			fetchNext := opts.FetchNext
			opts.FetchNext = false
			if _, err := b.MoveToDelayed(ctx, jobID, token, delay, opts); err != nil {
				return nil, err
			}
			if !fetchNext {
				return nil, nil
			}
			return &bullmq.FetchResult{}, nil
		},
	}
	nextDone := make(chan struct{})
	w := newTestWorker(t, be, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
		if job.ID == retried.ID {
			return nil, errors.New("retry later")
		}
		close(nextDone)
		return nil, nil
	}, &bullmq.WorkerOptions{Backend: hooks.wrap(be.Factory), DrainDelay: 5 * time.Second})
	var log eventLog
	log.collect(w)
	runWorker(t, w)

	select {
	case <-nextDone:
	case <-time.After(3 * time.Second):
		t.Fatal("the waiting job was not fetched after the retried one")
	}
	if n := log.count(bullmq.EventDrained); n != 0 {
		t.Errorf("EventDrained emitted %d times before the waiting job ran", n)
	}
}

// A force stop (cancelling the Run context) that lands while a finishing
// call fetches the next job must not start that job: it stays active for the
// stalled check to recover.
func TestWorkerDoesNotStartAChainedJobAfterRunIsCancelled(t *testing.T) {
	forEachBackend(t, testWorkerDoesNotStartAChainedJobAfterRunIsCancelled)
}

func testWorkerDoesNotStartAChainedJobAfterRunIsCancelled(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	ids := addJobs(t, ctx, q, 2)

	runCtx, cancelRun := context.WithCancel(context.Background())
	defer cancelRun()
	hooks := &backendHooks{
		onMoveToCompleted: func(ctx context.Context, b bullmq.Backend, jobID string, rv []byte, opts bullmq.FinishOptions) (*bullmq.FinishResult, error) {
			res, err := b.MoveToCompleted(ctx, jobID, rv, opts)
			cancelRun()
			return res, err
		},
	}
	var mu sync.Mutex
	var started []string
	w := newTestWorker(t, be, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
		mu.Lock()
		started = append(started, job.ID)
		mu.Unlock()
		return nil, nil
	}, &bullmq.WorkerOptions{Backend: hooks.wrap(be.Factory), SkipStalledCheck: true})
	runDone := make(chan error, 1)
	go func() { runDone <- w.Run(runCtx) }()
	t.Cleanup(func() { _ = w.Close() })

	select {
	case <-runDone:
	case <-time.After(10 * time.Second):
		t.Fatal("Run did not return after its context was cancelled")
	}
	if hooks.fetchNext.Load() == 0 {
		t.Fatal("the first job was not finished with fetch-next")
	}
	mu.Lock()
	defer mu.Unlock()
	if len(started) != 1 || started[0] != ids[0] {
		t.Fatalf("processed jobs %v, want only %s", started, ids[0])
	}
	requireState(t, ctx, q, ids[1], bullmq.StateActive)
}

// A job added while another one runs is picked up by a free slot right away,
// not once the running job finishes.
func TestWorkerFillsFreeSlotsWhileJobsRun(t *testing.T) {
	forEachBackend(t, testWorkerFillsFreeSlotsWhileJobsRun)
}

func testWorkerFillsFreeSlotsWhileJobsRun(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseAll := func() { releaseOnce.Do(func() { close(release) }) }
	longStarted := make(chan struct{})
	shortDone := make(chan struct{})
	w := newTestWorker(t, be, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
		if job.Name == "long" {
			close(longStarted)
			<-release
			return nil, nil
		}
		close(shortDone)
		return nil, nil
	}, &bullmq.WorkerOptions{Concurrency: 2, DrainDelay: 5 * time.Second})
	var log eventLog
	log.collect(w)
	runWorker(t, w)
	t.Cleanup(releaseAll)

	if _, err := q.Add(ctx, "long", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	select {
	case <-longStarted:
	case <-time.After(10 * time.Second):
		t.Fatal("the long job did not start")
	}
	waitFor(t, 5*time.Second, "the worker to see the queue drained", func() bool {
		return log.count(bullmq.EventDrained) > 0
	})
	time.Sleep(100 * time.Millisecond)

	start := time.Now()
	if _, err := q.Add(ctx, "short", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	select {
	case <-shortDone:
		t.Logf("the short job ran after %v", time.Since(start))
	case <-time.After(2 * time.Second):
		t.Fatal("a job added while another one ran was not picked up by the free slot")
	}
	releaseAll()
}

// When the queue announces a delayed job, an idle worker waits until it is
// due instead of fetching right away and finding nothing.
func TestWorkerWaitsUntilTheAnnouncedDelayedJobIsDue(t *testing.T) {
	forEachBackend(t, testWorkerWaitsUntilTheAnnouncedDelayedJobIsDue)
}

func testWorkerWaitsUntilTheAnnouncedDelayedJobIsDue(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	hooks := &backendHooks{}
	processed := make(chan time.Time, 1)
	w := newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) {
		processed <- time.Now()
		return nil, nil
	}, &bullmq.WorkerOptions{Backend: hooks.wrap(be.Factory), DrainDelay: 5 * time.Second})
	var log eventLog
	log.collect(w)
	runWorker(t, w)
	waitFor(t, 5*time.Second, "the worker to see the queue drained", func() bool {
		return log.count(bullmq.EventDrained) > 0
	})
	time.Sleep(100 * time.Millisecond)

	before := hooks.moveToActive.Load()
	start := time.Now()
	if _, err := q.Add(ctx, "later", nil, &bullmq.JobOptions{Delay: bullmq.Int64(700)}); err != nil {
		t.Fatalf("Add: %v", err)
	}
	select {
	case at := <-processed:
		if elapsed := at.Sub(start); elapsed < 600*time.Millisecond || elapsed > 3*time.Second {
			t.Errorf("the delayed job ran after %v, want about 700ms", elapsed)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the delayed job was never processed")
	}
	if n := hooks.moveToActive.Load() - before; n != 1 {
		t.Errorf("the worker fetched %d times for the delayed job, want 1", n)
	}
}
