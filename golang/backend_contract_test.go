package bullmq_test

import (
	"context"
	"errors"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// These tests exercise the Backend contract directly, so every datastore of
// the matrix is held to the same semantics the worker relies on.

const contractLock = 30 * time.Second

// fetchOpts are the settings a worker uses to fetch a job with token.
func fetchOpts(token string) bullmq.MoveToActiveOptions {
	return bullmq.MoveToActiveOptions{Token: token, LockDuration: contractLock, WorkerName: "contract"}
}

// finishOpts are the settings a worker uses to finish a job held with token.
func finishOpts(token string, fetchNext bool) bullmq.FinishOptions {
	return bullmq.FinishOptions{
		Token:        token,
		LockDuration: contractLock,
		WorkerName:   "contract",
		FetchNext:    fetchNext,
	}
}

// addJobs adds n plain jobs to q and returns their ids in order.
func addJobs(t *testing.T, ctx context.Context, q *bullmq.Queue, n int) []string {
	t.Helper()
	ids := make([]string, n)
	for i := range n {
		job, err := q.Add(ctx, "contract", i, nil)
		if err != nil {
			t.Fatalf("Add: %v", err)
		}
		ids[i] = job.ID
	}
	return ids
}

// fetch moves the next job of b to active with token and fails the test when
// none is fetched.
func fetch(t *testing.T, ctx context.Context, b bullmq.Backend, token string) *bullmq.JobRecord {
	t.Helper()
	res, err := b.MoveToActive(ctx, fetchOpts(token))
	if err != nil {
		t.Fatalf("MoveToActive: %v", err)
	}
	if res == nil || res.Job == nil {
		t.Fatalf("MoveToActive fetched no job: %+v", res)
	}
	return res.Job
}

// requireLockedBy checks that the job is active and that token owns its lock.
func requireLockedBy(t *testing.T, ctx context.Context, q *bullmq.Queue, jobID, token string) {
	t.Helper()
	requireState(t, ctx, q, jobID, bullmq.StateActive)
	if err := q.Backend().ExtendLock(ctx, jobID, token, contractLock); err != nil {
		t.Fatalf("ExtendLock(%s) with token %s: %v", jobID, token, err)
	}
}

// newBlockingBackend builds a backend for queueName with a dedicated blocking
// connection, as a worker gets, and closes it when the test ends.
func newBlockingBackend(t *testing.T, be testBackend, queueName string) bullmq.Backend {
	t.Helper()
	b, err := be.Factory(queueName, bullmq.BackendOptions{
		WithBlockingConnection: true,
		BlockTimeout:           5 * time.Second,
	})
	if err != nil {
		t.Fatalf("backend factory: %v", err)
	}
	t.Cleanup(func() { _ = b.Close() })
	return b
}

func TestBackendMoveToActiveReportsTheNextDelayedJob(t *testing.T) {
	forEachBackend(t, testBackendMoveToActiveReportsTheNextDelayedJob)
}

func testBackendMoveToActiveReportsTheNextDelayedJob(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	job, err := q.Add(ctx, "later", nil, &bullmq.JobOptions{Delay: bullmq.Int64(60_000)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	due := job.Timestamp + 60_000

	res, err := q.Backend().MoveToActive(ctx, fetchOpts("t1"))
	if err != nil {
		t.Fatalf("MoveToActive: %v", err)
	}
	if res.Job != nil || res.RateLimitDelay != 0 {
		t.Fatalf("MoveToActive = %+v, want no job and no rate limit", res)
	}
	if res.NextDelayedAt < due-1000 || res.NextDelayedAt > due+1000 {
		t.Fatalf("NextDelayedAt = %d, want about %d", res.NextDelayedAt, due)
	}
}

func TestBackendMoveToActiveReportsAnEmptyQueue(t *testing.T) {
	forEachBackend(t, testBackendMoveToActiveReportsAnEmptyQueue)
}

func testBackendMoveToActiveReportsAnEmptyQueue(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	res, err := q.Backend().MoveToActive(ctx, fetchOpts("t1"))
	if err != nil {
		t.Fatalf("MoveToActive: %v", err)
	}
	if res.Job != nil || res.RateLimitDelay != 0 || res.NextDelayedAt != 0 {
		t.Fatalf("MoveToActive = %+v, want an empty result", res)
	}
}

func TestBackendSetRateLimitIsReportedByMoveToActive(t *testing.T) {
	forEachBackend(t, testBackendSetRateLimitIsReportedByMoveToActive)
}

func testBackendSetRateLimitIsReportedByMoveToActive(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	addJobs(t, ctx, q, 1)
	b := q.Backend()

	if err := b.SetRateLimit(ctx, 2*time.Second); err != nil {
		t.Fatalf("SetRateLimit: %v", err)
	}
	opts := fetchOpts("t1")
	opts.Limiter = &bullmq.RateLimiter{Max: 1, Duration: time.Second}
	res, err := b.MoveToActive(ctx, opts)
	if err != nil {
		t.Fatalf("MoveToActive: %v", err)
	}
	if res.Job != nil {
		t.Fatalf("MoveToActive fetched job %s while rate limited", res.Job.ID)
	}
	if res.RateLimitDelay <= 0 || res.RateLimitDelay > 2*time.Second {
		t.Fatalf("RateLimitDelay = %v, want within (0, 2s]", res.RateLimitDelay)
	}

	if err := b.SetRateLimit(ctx, 0); err == nil {
		t.Fatal("SetRateLimit(0) succeeded, want an error")
	}
}

func TestBackendFinishingWithoutFetchNextReportsNoNextJob(t *testing.T) {
	forEachBackend(t, testBackendFinishingWithoutFetchNextReportsNoNextJob)
}

func testBackendFinishingWithoutFetchNextReportsNoNextJob(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	ids := addJobs(t, ctx, q, 3)
	b := q.Backend()

	first := fetch(t, ctx, b, "t1")
	before := time.Now().UnixMilli()
	res, err := b.MoveToCompleted(ctx, first.ID, []byte(`"done"`), finishOpts("t1", false))
	if err != nil {
		t.Fatalf("MoveToCompleted: %v", err)
	}
	if res.Next != nil {
		t.Fatalf("MoveToCompleted without FetchNext returned Next = %+v, want nil", res.Next)
	}
	if res.FinishedOn < before-1000 || res.FinishedOn > time.Now().UnixMilli()+1000 {
		t.Fatalf("FinishedOn = %d, want about %d", res.FinishedOn, before)
	}

	second := fetch(t, ctx, b, "t2")
	res, err = b.MoveToFailed(ctx, second.ID, bullmq.FailureInfo{Reason: "boom"}, finishOpts("t2", false))
	if err != nil {
		t.Fatalf("MoveToFailed: %v", err)
	}
	if res.Next != nil || res.FinishedOn == 0 {
		t.Fatalf("MoveToFailed without FetchNext = %+v, want FinishedOn and no Next", res)
	}
	requireState(t, ctx, q, ids[2], bullmq.StateWaiting)
}

func TestBackendMoveToCompletedFetchesTheNextJob(t *testing.T) {
	forEachBackend(t, testBackendMoveToCompletedFetchesTheNextJob)
}

func testBackendMoveToCompletedFetchesTheNextJob(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	ids := addJobs(t, ctx, q, 2)
	b := q.Backend()

	first := fetch(t, ctx, b, "t1")
	res, err := b.MoveToCompleted(ctx, first.ID, []byte(`1`), finishOpts("t1", true))
	if err != nil {
		t.Fatalf("MoveToCompleted: %v", err)
	}
	requireState(t, ctx, q, first.ID, bullmq.StateCompleted)
	if res.Next == nil || res.Next.Job == nil {
		t.Fatalf("MoveToCompleted with FetchNext returned Next = %+v, want the next job", res.Next)
	}
	if res.Next.Job.ID != ids[1] || res.Next.Job.Name != "contract" {
		t.Fatalf("next job = %s (%s), want %s", res.Next.Job.ID, res.Next.Job.Name, ids[1])
	}
	requireLockedBy(t, ctx, q, ids[1], "t1")

	// Nothing left: the next job is reported as missing, not as "not requested".
	res, err = b.MoveToCompleted(ctx, ids[1], []byte(`2`), finishOpts("t1", true))
	if err != nil {
		t.Fatalf("MoveToCompleted: %v", err)
	}
	if res.Next == nil || res.Next.Job != nil {
		t.Fatalf("MoveToCompleted on an empty queue returned Next = %+v, want an empty result", res.Next)
	}
	requireState(t, ctx, q, ids[1], bullmq.StateCompleted)
}

func TestBackendMoveToFailedFetchesTheNextJob(t *testing.T) {
	forEachBackend(t, testBackendMoveToFailedFetchesTheNextJob)
}

func testBackendMoveToFailedFetchesTheNextJob(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	ids := addJobs(t, ctx, q, 2)
	b := q.Backend()

	first := fetch(t, ctx, b, "t1")
	res, err := b.MoveToFailed(ctx, first.ID, bullmq.FailureInfo{Reason: "boom", Stacktrace: []string{"boom"}}, finishOpts("t1", true))
	if err != nil {
		t.Fatalf("MoveToFailed: %v", err)
	}
	requireState(t, ctx, q, first.ID, bullmq.StateFailed)
	if res.Next == nil || res.Next.Job == nil || res.Next.Job.ID != ids[1] {
		t.Fatalf("MoveToFailed with FetchNext returned Next = %+v, want job %s", res.Next, ids[1])
	}
	requireLockedBy(t, ctx, q, ids[1], "t1")
}

func TestBackendFetchNextReportsTheRateLimit(t *testing.T) {
	forEachBackend(t, testBackendFetchNextReportsTheRateLimit)
}

func testBackendFetchNextReportsTheRateLimit(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	ids := addJobs(t, ctx, q, 2)
	b := q.Backend()

	first := fetch(t, ctx, b, "t1")
	if err := b.SetRateLimit(ctx, 2*time.Second); err != nil {
		t.Fatalf("SetRateLimit: %v", err)
	}
	opts := finishOpts("t1", true)
	opts.Limiter = &bullmq.RateLimiter{Max: 1, Duration: time.Second}
	res, err := b.MoveToCompleted(ctx, first.ID, nil, opts)
	if err != nil {
		t.Fatalf("MoveToCompleted: %v", err)
	}
	if res.Next == nil || res.Next.Job != nil {
		t.Fatalf("Next = %+v, want no job while rate limited", res.Next)
	}
	if res.Next.RateLimitDelay <= 0 || res.Next.RateLimitDelay > 2*time.Second {
		t.Fatalf("Next.RateLimitDelay = %v, want within (0, 2s]", res.Next.RateLimitDelay)
	}
	requireState(t, ctx, q, ids[1], bullmq.StateWaiting)
}

func TestBackendMoveToDelayedFetchesTheNextJob(t *testing.T) {
	forEachBackend(t, testBackendMoveToDelayedFetchesTheNextJob)
}

func testBackendMoveToDelayedFetchesTheNextJob(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	ids := addJobs(t, ctx, q, 3)
	b := q.Backend()

	first := fetch(t, ctx, b, "t1")
	next, err := b.MoveToDelayed(ctx, first.ID, "t1", time.Minute, bullmq.MoveToDelayedOptions{SkipAttempt: true})
	if err != nil {
		t.Fatalf("MoveToDelayed: %v", err)
	}
	if next != nil {
		t.Fatalf("MoveToDelayed without FetchNext returned %+v, want nil", next)
	}
	requireState(t, ctx, q, first.ID, bullmq.StateDelayed)

	second := fetch(t, ctx, b, "t2")
	next, err = b.MoveToDelayed(ctx, second.ID, "t2", time.Minute, bullmq.MoveToDelayedOptions{
		SkipAttempt:  true,
		FetchNext:    true,
		LockDuration: contractLock,
		WorkerName:   "contract",
	})
	if err != nil {
		t.Fatalf("MoveToDelayed: %v", err)
	}
	requireState(t, ctx, q, second.ID, bullmq.StateDelayed)
	if next == nil || next.Job == nil || next.Job.ID != ids[2] {
		t.Fatalf("MoveToDelayed with FetchNext returned %+v, want job %s", next, ids[2])
	}
	requireLockedBy(t, ctx, q, ids[2], "t2")
}

func TestBackendMoveJobFromActiveToWait(t *testing.T) {
	forEachBackend(t, testBackendMoveJobFromActiveToWait)
}

func testBackendMoveJobFromActiveToWait(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	b := q.Backend()
	prio, err := q.Add(ctx, "prio", nil, &bullmq.JobOptions{Priority: bullmq.Int64(5)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	fetch(t, ctx, b, "t1")
	if _, err := b.MoveJobFromActiveToWait(ctx, prio.ID, "not-the-token"); !errors.Is(err, bullmq.ErrJobLockMismatch) {
		t.Fatalf("MoveJobFromActiveToWait with a foreign token: err = %v, want ErrJobLockMismatch", err)
	}
	ttl, err := b.MoveJobFromActiveToWait(ctx, prio.ID, "t1")
	if err != nil || ttl != 0 {
		t.Fatalf("MoveJobFromActiveToWait = %v, %v; want 0, nil", ttl, err)
	}
	// A prioritized job keeps its priority.
	requireState(t, ctx, q, prio.ID, bullmq.StatePrioritized)
	if held, err := be.Fixture.LockExists(ctx, b, prio.ID); err != nil || held {
		t.Fatalf("lock held = %v (%v), want false", held, err)
	}

	// The job is fetched again with no attempt counted, and the remaining
	// rate limit is reported.
	again := fetch(t, ctx, b, "t2")
	if again.ID != prio.ID || again.AttemptsMade != 0 {
		t.Fatalf("fetched %s with %d attempts made, want %s with 0", again.ID, again.AttemptsMade, prio.ID)
	}
	if err := b.SetRateLimit(ctx, 2*time.Second); err != nil {
		t.Fatalf("SetRateLimit: %v", err)
	}
	ttl, err = b.MoveJobFromActiveToWait(ctx, prio.ID, "t2")
	if err != nil || ttl <= 0 || ttl > 2*time.Second {
		t.Fatalf("MoveJobFromActiveToWait while rate limited = %v, %v; want within (0, 2s]", ttl, err)
	}

	// A plain job goes back to wait. It is fetched before the prioritized
	// one, and fetching without a limiter ignores the rate limit.
	plain := addJobs(t, ctx, q, 1)[0]
	if got := fetch(t, ctx, b, "t3"); got.ID != plain {
		t.Fatalf("fetched %s, want %s", got.ID, plain)
	}
	if _, err := b.MoveJobFromActiveToWait(ctx, plain, "t3"); err != nil {
		t.Fatalf("MoveJobFromActiveToWait: %v", err)
	}
	requireState(t, ctx, q, plain, bullmq.StateWaiting)

	if _, err := b.MoveJobFromActiveToWait(ctx, "missing", "t3"); !errors.Is(err, bullmq.ErrJobNotFound) {
		t.Fatalf("MoveJobFromActiveToWait on a missing job: err = %v, want ErrJobNotFound", err)
	}
}

func TestBackendWaitForJobReportsTheSignal(t *testing.T) {
	forEachBackend(t, testBackendWaitForJobReportsTheSignal)
}

func testBackendWaitForJobReportsTheSignal(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	b := newBlockingBackend(t, be, q.Name())

	delayed, err := q.Add(ctx, "later", nil, &bullmq.JobOptions{Delay: bullmq.Int64(60_000)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	due := delayed.Timestamp + 60_000
	res, err := b.WaitForJob(ctx, 2*time.Second)
	if err != nil {
		t.Fatalf("WaitForJob: %v", err)
	}
	if !res.Woken || res.NextDelayedAt < due-1000 || res.NextDelayedAt > due+1000 {
		t.Fatalf("WaitForJob after adding a delayed job = %+v, want woken with NextDelayedAt about %d", res, due)
	}

	addJobs(t, ctx, q, 1)
	res, err = b.WaitForJob(ctx, 2*time.Second)
	if err != nil {
		t.Fatalf("WaitForJob: %v", err)
	}
	if !res.Woken || res.NextDelayedAt != 0 {
		t.Fatalf("WaitForJob after adding a job = %+v, want woken without NextDelayedAt", res)
	}

	start := time.Now()
	res, err = b.WaitForJob(ctx, 300*time.Millisecond)
	if err != nil {
		t.Fatalf("WaitForJob: %v", err)
	}
	if res.Woken {
		// Spurious wake-ups are allowed, but nothing signalled here.
		t.Logf("WaitForJob woke up without a signal after %v", time.Since(start))
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("WaitForJob(300ms) returned after %v", elapsed)
	}
}

func TestBackendWaitForJobReturnsWhenTheContextIsCancelled(t *testing.T) {
	forEachBackend(t, testBackendWaitForJobReturnsWhenTheContextIsCancelled)
}

func testBackendWaitForJobReturnsWhenTheContextIsCancelled(t *testing.T, be testBackend) {
	q := newTestQueue(t, be, nil)
	b := newBlockingBackend(t, be, q.Name())

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := b.WaitForJob(ctx, time.Minute)
		done <- err
	}()
	time.Sleep(100 * time.Millisecond)
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("WaitForJob after cancellation: err = %v, want context.Canceled", err)
		}
	case <-time.After(time.Second):
		t.Fatal("WaitForJob did not return promptly after its context was cancelled")
	}
}
