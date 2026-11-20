package bullmq

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"runtime/debug"
	"slices"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

// Processor handles a single job. The returned value is JSON encoded and stored
// as the job's return value.
//
// Returning an error fails the job; if attempts remain the job is retried using
// the configured backoff. Return an error created with [NewUnrecoverableError]
// to fail without retrying.
//
// ctx is cancelled when the context passed to [Worker.Run] is, when the worker
// loses the job's lock ([ErrLockLost]), and by [Worker.CancelJob]
// ([ErrJobCancelled]); context.Cause tells which. An error returned after the
// worker itself cancelled ctx (Run or the lock) is not recorded: the job is left
// active, without using up an attempt, for the stalled check to recover. After
// CancelJob the job fails with the cancellation reason.
type Processor func(ctx context.Context, job *Job) (any, error)

// EventType identifies a worker lifecycle event.
type EventType string

// Worker event types.
const (
	EventActive    EventType = "active"
	EventCompleted EventType = "completed"
	EventFailed    EventType = "failed"
	EventProgress  EventType = "progress"
	// EventStalled reports a job that the stalled check of this worker
	// moved back to wait (or failed) because its lock had expired.
	EventStalled EventType = "stalled"
	// EventLockRenewalFailed lists, in Event.JobIDs, the jobs of this worker
	// whose lock could not be renewed. Their contexts are cancelled with
	// ErrLockLost, since another worker may own them now; Node.js only
	// reports them.
	EventLockRenewalFailed EventType = "lockRenewalFailed"
	// EventLocksRenewed lists, in Event.JobIDs, the jobs whose locks were
	// renewed.
	EventLocksRenewed EventType = "locksRenewed"
	EventDrained      EventType = "drained"
	EventError        EventType = "error"
	EventClosed       EventType = "closed"
)

// Event is emitted by a Worker through Worker.Events.
type Event struct {
	// Type is the kind of event.
	Type EventType
	// Job is the job the event refers to; nil for EventDrained, EventError,
	// EventClosed and the lock events.
	Job *Job
	// JobIDs lists the jobs of EventLockRenewalFailed and EventLocksRenewed.
	JobIDs []string
	// Result is the processor return value for EventCompleted, or the new
	// Progress value for EventProgress.
	Result any
	// Err carries the failure for EventFailed and EventError.
	Err error
}

// Worker fetches jobs from a queue and hands them to a Processor.
//
// Every processing slot finishes its job and fetches the next one in the same
// backend call (fetch-next), as the Node.js worker does, so a busy worker
// needs about one round trip per job whatever its concurrency. The fetch loop
// only fetches to fill free slots, and blocks on the backend only once the
// queue looks drained.
type Worker struct {
	backend Backend
	opts    WorkerOptions
	proc    Processor

	id     string
	tokens atomic.Uint64

	events chan Event
	// eventsMu guards eventsClosed against closing the events channel
	// while an event is being sent on it.
	eventsMu      sync.RWMutex
	eventsClosed  bool
	droppedEvents atomic.Uint64

	runOnce   sync.Once
	stopOnce  sync.Once
	closeOnce sync.Once
	closeErr  error
	stop      chan struct{}
	wg        sync.WaitGroup

	paused atomic.Bool
	// pauseMu guards pausedIdle and loopRunning. pausedIdle is created by
	// Pause and closed once the worker is paused with no job in flight (or
	// resumed, or stopped), which is what Pause waits for.
	pauseMu     sync.Mutex
	pausedIdle  chan struct{}
	loopRunning bool

	// slots holds one token per free processing slot.
	slots chan struct{}
	// wake tells the fetch loop that a slot was freed or that it was asked
	// to fetch again (see refetch), and ctrl that the worker was paused or
	// resumed. Both hold at most one pending signal.
	wake chan struct{}
	ctrl chan struct{}
	// drained is set by every fetch that finds no job and cleared by every
	// fetch that returns one. EventDrained is emitted when it gets set.
	drained atomic.Bool
	// refetch asks the fetch loop to fetch even though the queue looked
	// drained, for example after a job was put straight back in the wait
	// list.
	refetch atomic.Bool
	// limitUntil is when the last rate limit reported by a fetch lifts, and
	// blockUntil when the next delayed job is due (Unix milliseconds, 0 for
	// none).
	limitUntil atomic.Int64
	blockUntil atomic.Int64

	mu     sync.Mutex
	active map[string]*activeJob
}

type activeJob struct {
	job *Job
	// cancel cancels the job's context with a cause: ErrLockLost, or a
	// cancelledError for Worker.CancelJob.
	cancel context.CancelCauseFunc
	// lockLost is set once the job's lock could not be renewed. It is
	// guarded by Worker.mu and keeps the entry out of later renewal
	// snapshots, so a processor that is slow to honor cancellation cannot
	// produce a lock event on every tick.
	lockLost bool
}

// clientNameSuffix returns the suffix of a worker's blocking connection name:
// empty when no explicit WorkerOptions.Name is configured (matching
// Queue.Workers' "unnamed" check and the other BullMQ ports), or ":w:<name>"
// when one is set. It intentionally does not fall back to the worker's
// internally generated id, since that would make every worker appear "named"
// and diverge from the other ports.
func clientNameSuffix(name string) string {
	if name == "" {
		return ""
	}
	return ":w:" + name
}

// NewWorker creates a worker for the given queue. Call Run to start processing.
func NewWorker(queueName string, proc Processor, opts *WorkerOptions) (*Worker, error) {
	if proc == nil {
		return nil, configError("a processor function is required")
	}
	if opts == nil {
		opts = &WorkerOptions{}
	}
	o := *opts
	if err := o.applyDefaults(); err != nil {
		return nil, err
	}

	backend, err := resolveBackend(o.Backend, queueName, BackendOptions{
		WithBlockingConnection: true,
		ClientNameSuffix:       clientNameSuffix(o.Name),
		BlockTimeout:           o.DrainDelay,
	})
	if err != nil {
		return nil, err
	}

	w := &Worker{
		backend: backend,
		opts:    o,
		proc:    proc,
		id:      randomID(),
		events:  make(chan Event, 256),
		stop:    make(chan struct{}),
		slots:   make(chan struct{}, o.Concurrency),
		wake:    make(chan struct{}, 1),
		ctrl:    make(chan struct{}, 1),
		active:  make(map[string]*activeJob),
	}
	for range o.Concurrency {
		w.slots <- struct{}{}
	}
	return w, nil
}

// Name returns the worker name, falling back to its generated id.
func (w *Worker) Name() string {
	if w.opts.Name != "" {
		return w.opts.Name
	}
	return w.id
}

// ID returns the unique id of this worker instance.
func (w *Worker) ID() string { return w.id }

// Events returns the channel on which lifecycle events are published. It is
// closed by Close.
//
// The channel is buffered; events are dropped when the consumer falls behind,
// so a worker never blocks on event delivery. DroppedEvents counts them. Use
// WorkerOptions.OnEvent to observe every event.
func (w *Worker) Events() <-chan Event { return w.events }

// DroppedEvents returns how many events could not be delivered on the
// Events channel because its buffer was full.
func (w *Worker) DroppedEvents() uint64 { return w.droppedEvents.Load() }

// Pause stops this worker from fetching new jobs, as Node's pause does. Unless
// doNotWaitActive is set, it then waits until the jobs in flight have
// finished, or until ctx is done (returning ctx's error), the worker is
// resumed or it stops. A processor pausing its own worker must set
// doNotWaitActive, since Pause would otherwise wait for it.
func (w *Worker) Pause(ctx context.Context, doNotWaitActive bool) error {
	w.pauseMu.Lock()
	if !w.paused.Load() {
		w.paused.Store(true)
		w.pausedIdle = make(chan struct{})
		if !w.loopRunning {
			close(w.pausedIdle)
		}
	}
	idle := w.pausedIdle
	w.pauseMu.Unlock()
	signal(w.ctrl)

	if doNotWaitActive {
		return nil
	}
	select {
	case <-idle:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Resume restarts fetching jobs after Pause.
func (w *Worker) Resume() {
	w.pauseMu.Lock()
	w.paused.Store(false)
	w.releasePauseLocked()
	w.pauseMu.Unlock()
	signal(w.ctrl)
}

// releasePauseLocked releases the callers of Pause. w.pauseMu must be held.
func (w *Worker) releasePauseLocked() {
	if w.pausedIdle == nil {
		return
	}
	select {
	case <-w.pausedIdle:
	default:
		close(w.pausedIdle)
	}
}

// setLoopRunning records whether the fetch loop runs, releasing the callers
// of Pause once it stops.
func (w *Worker) setLoopRunning(running bool) {
	w.pauseMu.Lock()
	defer w.pauseMu.Unlock()
	w.loopRunning = running
	if !running {
		w.releasePauseLocked()
	}
}

// IsPaused reports whether the worker is paused.
func (w *Worker) IsPaused() bool { return w.paused.Load() }

// ActiveCount returns how many jobs are currently being processed.
func (w *Worker) ActiveCount() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.active)
}

// CancelJob cancels the context of a job this worker is processing, with a
// cause (see context.Cause) that matches ErrJobCancelled and reads as reason.
// When the processor then returns an error, the job fails with reason as
// its failure (and is retried if attempts remain), as Node.js's cancelJob
// does. It reports whether the job was being processed.
func (w *Worker) CancelJob(jobID, reason string) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	a, ok := w.active[jobID]
	if ok {
		a.cancel(&cancelledError{reason: reason})
	}
	return ok
}

// CancelAllJobs cancels every job this worker is processing, as CancelJob
// does.
func (w *Worker) CancelAllJobs(reason string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, a := range w.active {
		a.cancel(&cancelledError{reason: reason})
	}
}

// Run starts the worker and blocks until ctx is cancelled or Close is called.
func (w *Worker) Run(ctx context.Context) error {
	var err error
	started := false
	w.runOnce.Do(func() {
		started = true
		err = w.run(ctx)
	})
	if !started {
		return ErrWorkerClosed
	}
	return err
}

func (w *Worker) run(ctx context.Context) error {
	// Backends that cannot name their dedicated blocking connection at creation
	// time (for example when it shares a caller-supplied client) do it here,
	// best-effort.
	name := w.backend.ClientName(clientNameSuffix(w.opts.Name))
	if e := w.backend.SetName(ctx, name); e != nil {
		w.emitError(fmt.Errorf("bullmq: unable to set client name: %w", e))
	}

	// loopCtx drives the fetch loop and the background stalled-check loop: it
	// is cancelled both when the caller's ctx is cancelled and when Close is
	// called (via w.stop), so those loops always stop promptly.
	//
	// ctx (the parameter) is what already-dispatched jobs run under. Close must
	// wait for in-flight jobs to finish rather than cancel them, so it is only
	// cancelled by the caller's ctx, never by w.stop; see fetchLoop, which
	// passes ctx (not loopCtx) to processJob.
	loopCtx, cancelLoop := context.WithCancel(ctx)
	defer cancelLoop()
	go func() {
		select {
		case <-w.stop:
			cancelLoop()
		case <-loopCtx.Done():
		}
	}()

	// renewCtx drives lock renewal. It must stay alive for as long as
	// in-flight jobs are processing, even after Close cancels loopCtx, or a
	// long-running job could lose its lock (and be picked up by another
	// worker) before its processor returns. It is only cancelled by the
	// caller's ctx directly, or explicitly below once fetchLoop has drained
	// all in-flight jobs.
	renewCtx, cancelRenew := context.WithCancel(context.WithoutCancel(ctx))

	if !w.opts.SkipStalledCheck {
		w.wg.Add(1)
		go func() {
			defer w.wg.Done()
			w.stalledCheckLoop(loopCtx)
		}()
	}
	if !w.opts.SkipLockRenewal {
		w.wg.Add(1)
		go func() {
			defer w.wg.Done()
			w.lockRenewalLoop(renewCtx)
		}()
	}

	// fetchLoop only returns once every in-flight job has finished processing
	// (it waits on that internally), so it is safe to stop lock renewal here.
	err := w.fetchLoop(loopCtx, ctx)
	cancelRenew()

	w.wg.Wait()
	w.emit(Event{Type: EventClosed})
	return err
}

// fetchLoop fills free processing slots with jobs and dispatches them to
// processing goroutines, keeping at most Concurrency jobs in flight. Each slot
// then keeps itself busy by fetching its next job when it finishes the
// current one (see runSlot), so this loop only fetches while slots are free.
//
// loopCtx controls fetching: it is cancelled by Close so the loop stops
// pulling new jobs. runCtx is what dispatched jobs run under; it is only
// cancelled by the caller (never by Close), so a graceful shutdown drains
// in-flight jobs instead of cancelling them.
func (w *Worker) fetchLoop(loopCtx, runCtx context.Context) error {
	w.setLoopRunning(true)
	defer w.setLoopRunning(false)
	var processing sync.WaitGroup
	defer processing.Wait()
	waiter := &jobWaiter{backend: w.backend, results: make(chan waitOutcome, 1)}
	defer waiter.stop()

	fetchNow := true
	for {
		if err := loopCtx.Err(); err != nil {
			return err
		}

		if w.IsPaused() {
			waiter.stop()
			if !w.waitUnpaused(loopCtx) {
				return loopCtx.Err()
			}
			fetchNow = true
			continue
		}

		// Fetching while rate limited only reports the limit again, and
		// blocking on the backend would wake up for every job added, so the
		// limit is slept out instead.
		if until := w.limitUntil.Load(); until > nowMillis() {
			if !w.waitRateLimit(loopCtx, until) {
				return loopCtx.Err()
			}
			fetchNow = true
			continue
		}

		if w.refetch.Swap(false) {
			fetchNow = true
		}

		if !fetchNow && w.drained.Load() {
			// Nothing to fetch: wait until a slot frees up, or until the
			// backend signals a job while at least one slot is free.
			if !waiter.running() && len(w.slots) > 0 {
				timeout := w.opts.DrainDelay
				if next := w.blockUntil.Swap(0); next > 0 {
					d := time.Until(time.UnixMilli(next))
					if d <= 0 {
						fetchNow = true
						continue
					}
					timeout = min(timeout, d)
				}
				waiter.start(loopCtx, timeout)
			}
			var waited <-chan waitOutcome
			if waiter.running() {
				waited = waiter.results
			}
			select {
			case <-loopCtx.Done():
				return loopCtx.Err()
			case <-w.wake:
			case <-w.ctrl:
			case out := <-waited:
				waiter.done()
				if !w.afterWait(loopCtx, out) {
					return loopCtx.Err()
				}
				fetchNow = w.blockUntil.Load() == 0
			}
			continue
		}

		select {
		case <-loopCtx.Done():
			return loopCtx.Err()
		case <-w.wake:
			continue
		case <-w.ctrl:
			continue
		case <-w.slots:
		}
		if w.IsPaused() {
			w.slots <- struct{}{}
			continue
		}

		fetchNow = false
		token := w.nextToken()
		res, err := w.backend.MoveToActive(loopCtx, w.fetchOptions(token))
		if err != nil {
			w.slots <- struct{}{}
			if loopCtx.Err() != nil {
				return loopCtx.Err()
			}
			w.emitError(err)
			if !sleepCtx(loopCtx, 5*time.Second) {
				return loopCtx.Err()
			}
			fetchNow = true
			continue
		}
		if res == nil || res.Job == nil {
			w.slots <- struct{}{}
			w.noteEmptyFetch(res)
			continue
		}

		w.drained.Store(false)
		job := w.newActiveJob(res.Job, token)
		processing.Add(1)
		go func() {
			defer processing.Done()
			w.runSlot(runCtx, job)
		}()
	}
}

// afterWait handles the outcome of a WaitForJob call. It returns false when
// the worker is stopping.
func (w *Worker) afterWait(ctx context.Context, out waitOutcome) bool {
	if out.err != nil {
		if ctx.Err() != nil {
			return false
		}
		if errors.Is(out.err, context.Canceled) {
			// Interrupted by a pause.
			return true
		}
		w.emitError(out.err)
		return sleepCtx(ctx, time.Second)
	}
	// A marker for a delayed job that is not due yet: keep waiting until it
	// is, without fetching.
	if out.res.Woken && out.res.NextDelayedAt > nowMillis() {
		w.blockUntil.Store(out.res.NextDelayedAt)
	}
	return true
}

// waitUnpaused blocks until the worker is resumed, releasing the callers of
// Pause once no job is in flight anymore. It returns false when ctx is done
// first.
func (w *Worker) waitUnpaused(ctx context.Context) bool {
	for w.IsPaused() {
		if len(w.slots) == cap(w.slots) {
			w.pauseMu.Lock()
			if w.paused.Load() {
				w.releasePauseLocked()
			}
			w.pauseMu.Unlock()
		}
		select {
		case <-ctx.Done():
			return false
		case <-w.ctrl:
		case <-w.wake:
		}
	}
	return true
}

// waitRateLimit sleeps until the rate limit that lifts at until (Unix
// milliseconds) is over, for at most MaximumRateLimitDelay. A pause or resume
// cuts the sleep short. It returns false when ctx is done first.
func (w *Worker) waitRateLimit(ctx context.Context, until int64) bool {
	d := min(time.Until(time.UnixMilli(until)), w.opts.MaximumRateLimitDelay)
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-w.ctrl:
		return true
	case <-t.C:
	}
	w.limitUntil.CompareAndSwap(until, 0)
	return true
}

// noteEmptyFetch records why a fetch found no job and emits EventDrained the
// first time the queue is seen drained.
func (w *Worker) noteEmptyFetch(res *FetchResult) {
	if res != nil {
		if res.RateLimitDelay > 0 {
			w.limitUntil.Store(nowMillis() + res.RateLimitDelay.Milliseconds())
		}
		w.blockUntil.Store(res.NextDelayedAt)
	} else {
		w.blockUntil.Store(0)
	}
	if !w.drained.Swap(true) {
		w.emit(Event{Type: EventDrained})
	}
}

// runSlot processes job, and then every job fetched when finishing the
// previous one, until a finish brings no next job. The slot is then freed.
func (w *Worker) runSlot(runCtx context.Context, job *Job) {
	defer func() {
		w.slots <- struct{}{}
		signal(w.wake)
	}()
	for job != nil {
		next := w.processJob(runCtx, job)
		job = w.chainedJob(runCtx, job.token, next)
	}
}

// nextFetch is what finishing an attempt reports about the slot's next job.
type nextFetch struct {
	// res is the outcome of fetching the next job; nil when none was
	// requested or the transition failed.
	res *FetchResult
	// delayed is set when res comes from MoveToDelayed, whose empty result
	// means "fetch again" rather than "drained".
	delayed bool
	// refetch asks the fetch loop to fetch again, because the job was put
	// straight back in the wait list.
	refetch bool
}

// chainedJob turns the outcome of a finish into the next job of the slot, or
// nil to free the slot.
func (w *Worker) chainedJob(runCtx context.Context, token string, next nextFetch) *Job {
	if next.refetch {
		w.refetch.Store(true)
	}
	if next.res == nil || next.res.Job == nil {
		switch {
		case next.delayed:
			w.refetch.Store(true)
		case next.res != nil:
			w.noteEmptyFetch(next.res)
		}
		return nil
	}
	w.drained.Store(false)
	// The worker was stopped forcefully while the next job was fetched: leave
	// it active, unprocessed, for the stalled check to recover.
	if runCtx.Err() != nil {
		return nil
	}
	return w.newActiveJob(next.res.Job, token)
}

// canFetchNext reports whether finishing a job should also fetch the next
// one.
func (w *Worker) canFetchNext(runCtx context.Context) bool {
	if runCtx.Err() != nil || w.IsPaused() {
		return false
	}
	select {
	case <-w.stop:
		return false
	default:
		return true
	}
}

// waitOutcome is the result of a WaitForJob call made by a jobWaiter.
type waitOutcome struct {
	res WaitResult
	err error
}

// jobWaiter runs Backend.WaitForJob on its own goroutine, so the fetch loop
// keeps reacting to local events (a slot freed, a pause) while the backend
// blocks. At most one wait is outstanding. It is only used by the fetch loop.
type jobWaiter struct {
	backend Backend
	results chan waitOutcome
	cancel  context.CancelFunc
}

func (jw *jobWaiter) running() bool { return jw.cancel != nil }

func (jw *jobWaiter) start(ctx context.Context, timeout time.Duration) {
	wctx, cancel := context.WithCancel(ctx)
	jw.cancel = cancel
	go func() {
		res, err := jw.backend.WaitForJob(wctx, timeout)
		jw.results <- waitOutcome{res: res, err: err}
	}()
}

// done must be called once the outcome of a wait has been received.
func (jw *jobWaiter) done() {
	jw.cancel()
	jw.cancel = nil
}

// stop interrupts an outstanding wait and discards its outcome.
func (jw *jobWaiter) stop() {
	if jw.cancel == nil {
		return
	}
	jw.cancel()
	<-jw.results
	jw.cancel = nil
}

// signal leaves a pending signal on ch unless one is already pending.
func signal(ch chan struct{}) {
	select {
	case ch <- struct{}{}:
	default:
	}
}

// fetchOptions are the settings used to fetch a job locked with token.
func (w *Worker) fetchOptions(token string) MoveToActiveOptions {
	return MoveToActiveOptions{
		Token:        token,
		LockDuration: w.opts.LockDuration,
		WorkerName:   w.opts.Name,
		Limiter:      w.opts.Limiter,
	}
}

// newActiveJob wraps a job this worker moved to active with token.
func (w *Worker) newActiveJob(rec *JobRecord, token string) *Job {
	job := newJob(w.backend, rec)
	job.token = token
	job.lockDuration = w.opts.LockDuration
	job.worker = w
	return job
}

func (w *Worker) nextToken() string {
	return w.id + ":" + strconv.FormatUint(w.tokens.Add(1), 10)
}

// processJob runs one attempt of job and moves the job to its next state.
// Unless the worker is pausing or stopping, that transition also fetches the
// next job for this slot, which is returned for chaining.
func (w *Worker) processJob(runCtx context.Context, job *Job) nextFetch {
	jobCtx, cancel := context.WithCancelCause(runCtx)
	entry := &activeJob{job: job, cancel: cancel}
	w.mu.Lock()
	w.active[job.ID] = entry
	w.mu.Unlock()
	defer func() {
		w.mu.Lock()
		if current, ok := w.active[job.ID]; ok && current == entry {
			delete(w.active, job.ID)
		}
		w.mu.Unlock()
		cancel(nil)
	}()

	w.emit(Event{Type: EventActive, Job: job})

	// The Go port has no JobScheduler: it cannot parse repeat options (cron,
	// tz, every) or run the addJobScheduler script that materializes the
	// scheduler's next iteration, unlike the Node and Python workers, which
	// upsert the scheduler right here before processing (see
	// src/classes/worker.ts's nextJobFromJobData and
	// python/bullmq/worker.py's _scheduleNextIteration). Processing the job
	// itself is still correct and safe, but silently doing so would leave
	// users unaware that the schedule stops after this iteration, so surface
	// it as an explicit error instead.
	if job.RepeatJobKey != "" {
		w.emitError(fmt.Errorf(
			"bullmq: job %s was produced by job scheduler %q; the Go worker cannot advance job schedulers, so the schedule stops after this iteration; Go workers must not consume queues containing job scheduler jobs",
			job.ID, job.RepeatJobKey,
		))
	}

	var result any
	var err error
	switch maxStarted := int64(w.opts.MaxStartedAttempts); {
	case job.DeferredFailure != "":
		// The stalled-check script found this job exceeded MaxStalledCount and
		// stored the reason in "defa" instead of failing it outright, so it
		// must be failed unrecoverably here rather than handed to the processor.
		// It takes precedence over MaxStartedAttempts, as in Node.js.
		err = &UnrecoverableError{Message: job.DeferredFailure}
	case maxStarted > 0 && maxStarted < job.AttemptsStarted:
		err = &UnrecoverableError{Message: "job started more than allowable limit"}
	default:
		result, err = w.safeProcess(jobCtx, job)
	}

	// The processor took ownership of the job's next state.
	if errors.Is(err, ErrDelayed) || errors.Is(err, ErrWaitingChildren) {
		return w.fetchAfterHandOff(runCtx, job.token)
	}

	if err != nil && jobCtx.Err() != nil {
		cause := context.Cause(jobCtx)
		if !errors.Is(cause, ErrJobCancelled) {
			// The worker itself interrupted the job: it was stopped (the Run
			// context was cancelled) or lost the job's lock. Failing the job
			// would use up an attempt for no fault of its own, so it is left
			// active for the stalled check to recover, as Node.js does.
			return nextFetch{}
		}
		// Cancelled with CancelJob: fail with the reason, as Node.js does.
		if errors.Is(err, context.Canceled) {
			err = cause
		}
	}

	if errors.Is(err, ErrRateLimited) {
		return w.moveBackToWait(runCtx, job)
	}

	if err != nil {
		return w.fail(runCtx, job, err)
	}

	// A result that cannot be encoded is a genuine job failure, unlike an
	// error from the completion transition below.
	raw, merr := json.Marshal(result)
	if merr != nil {
		return w.fail(runCtx, job, merr)
	}

	// The processor succeeded, so a failure to record that is never turned
	// into a job failure: transient errors are retried, and anything else
	// (e.g. the lock was lost) is reported and left to the stalled check.
	fetchNext := w.canFetchNext(runCtx)
	var finished *FinishResult
	if cerr := w.retryTransition(runCtx, func(c context.Context) error {
		var err error
		finished, err = w.moveToCompleted(c, job, raw, fetchNext)
		return err
	}); cerr != nil {
		w.emitError(cerr)
		return nextFetch{}
	}
	w.emit(Event{Type: EventCompleted, Job: job, Result: result})
	return nextFetch{res: finished.Next}
}

// fail records a failed attempt, retrying the job when attempts remain.
func (w *Worker) fail(runCtx context.Context, job *Job, cause error) nextFetch {
	// moveToFailed appends to job.Stacktrace, so restore it before every
	// attempt to keep retried transitions from duplicating entries.
	baseTrace := job.Stacktrace
	fetchNext := w.canFetchNext(runCtx)
	var next nextFetch
	ferr := w.retryTransition(runCtx, func(c context.Context) error {
		job.Stacktrace = baseTrace
		var err error
		next, err = w.moveToFailed(c, job, cause, fetchNext)
		return err
	})
	if ferr != nil {
		w.emitError(ferr)
		return nextFetch{}
	}
	w.emit(Event{Type: EventFailed, Job: job, Err: cause})
	return next
}

// moveBackToWait puts a job whose processor reported ErrRateLimited back in
// the wait list without using up an attempt, and makes the worker wait until
// the rate limit lifts.
func (w *Worker) moveBackToWait(runCtx context.Context, job *Job) nextFetch {
	var ttl time.Duration
	if err := w.retryTransition(runCtx, func(c context.Context) error {
		var err error
		ttl, err = w.backend.MoveJobFromActiveToWait(c, job.ID, job.token)
		return err
	}); err != nil {
		w.emitError(err)
		return nextFetch{}
	}
	if ttl > 0 {
		w.limitUntil.Store(nowMillis() + ttl.Milliseconds())
	}
	return nextFetch{}
}

// RateLimit rate limits the whole queue for d, as Node's rateLimit does:
// until it expires, workers that fetch with a limiter (WorkerOptions.Limiter
// or a global rate limit) get no job. A processor typically calls it and then
// returns ErrRateLimited, which puts its job back in the wait list.
func (w *Worker) RateLimit(ctx context.Context, d time.Duration) error {
	return w.backend.SetRateLimit(ctx, d)
}

// fetchAfterHandOff fetches the slot's next job once the processor itself
// moved its job out of active (to delayed or waiting-children), as finishing
// would have.
func (w *Worker) fetchAfterHandOff(runCtx context.Context, token string) nextFetch {
	if !w.canFetchNext(runCtx) {
		return nextFetch{}
	}
	res, err := w.backend.MoveToActive(runCtx, w.fetchOptions(token))
	if err != nil {
		if runCtx.Err() == nil {
			w.emitError(err)
		}
		return nextFetch{}
	}
	if res == nil {
		res = &FetchResult{}
	}
	return nextFetch{res: res}
}

// transitionTimeout bounds a single job-state transition attempt, and
// transitionRetryDelay is the pause between attempts after a transient error.
var (
	transitionTimeout    = 30 * time.Second
	transitionRetryDelay = 5 * time.Second
)

// retryTransition runs a job-state transition, retrying transient backend errors
// (connection loss, timeouts, server loading/failover) like the Node worker's
// retryIfFailed, so the lock keeps being renewed meanwhile. Other errors are
// returned immediately. Each attempt runs detached from ctx's cancellation so
// a cancelled job still gets reported, but retrying stops once the caller's
// ctx (the Run context) is cancelled; the first attempt is always made.
//
// Close deliberately does not stop retries: a graceful Close drains in-flight
// jobs while their locks keep being renewed, so abandoning a transition on a
// transient error would leave the job active until stalled recovery. Cancelling
// the Run context is the forced-stop signal.
func (w *Worker) retryTransition(ctx context.Context, fn func(context.Context) error) error {
	for {
		attemptCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), transitionTimeout)
		err := fn(attemptCtx)
		cancel()
		if err == nil || !w.backend.IsTransientError(err) {
			return err
		}

		t := time.NewTimer(transitionRetryDelay)
		select {
		case <-t.C:
		case <-ctx.Done():
			t.Stop()
			return err
		}
	}
}

// safeProcess invokes the processor, converting panics into job failures.
func (w *Worker) safeProcess(ctx context.Context, job *Job) (result any, err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("bullmq: processor panicked: %v\n%s", r, debug.Stack())
		}
	}()
	return w.proc(ctx, job)
}

func (w *Worker) moveToCompleted(ctx context.Context, job *Job, raw []byte, fetchNext bool) (*FinishResult, error) {
	opts := w.finishOptions(job, StateCompleted)
	opts.FetchNext = fetchNext
	res, err := w.backend.MoveToCompleted(ctx, job.ID, raw, opts)
	if err != nil {
		return nil, err
	}
	job.ReturnValue = raw
	job.FinishedOn = res.FinishedOn
	job.AttemptsMade++
	return res, nil
}

func (w *Worker) moveToFailed(ctx context.Context, job *Job, cause error, fetchNext bool) (nextFetch, error) {
	reason := cause.Error()
	failure := newFailureInfo(job, reason)
	job.FailedReason = reason
	job.Stacktrace = failure.Stacktrace

	attempts := int64(0)
	if job.Opts != nil {
		attempts = job.Opts.attemptsVal()
	}
	retriesLeft := !job.discarded &&
		!IsUnrecoverable(cause) &&
		job.AttemptsMade+1 < attempts

	if retriesLeft {
		delay, berr := w.backoffDelay(job, cause)
		switch {
		case berr != nil:
			// Retrying with an immediate zero delay would risk a tight retry
			// loop, so report the problem and fail the job instead.
			w.emitError(berr)
		case delay > 0:
			return w.retryLater(ctx, job, delay, &failure, fetchNext)
		case delay == 0:
			if err := w.backend.RetryJob(ctx, job.ID, job.token, job.Opts.isLIFO(), &failure); err != nil {
				return nextFetch{}, err
			}
			job.AttemptsMade++
			return nextFetch{refetch: true}, nil
		}
	}

	opts := w.finishOptions(job, StateFailed)
	opts.FetchNext = fetchNext
	res, err := w.backend.MoveToFailed(ctx, job.ID, failure, opts)
	if err != nil {
		return nextFetch{}, err
	}
	job.FinishedOn = res.FinishedOn
	job.AttemptsMade++
	return nextFetch{res: res.Next}, nil
}

// retryLater moves a failed job to the delayed set until its backoff delay
// has passed and, with fetchNext, fetches the slot's next job.
func (w *Worker) retryLater(ctx context.Context, job *Job, delay time.Duration, failure *FailureInfo, fetchNext bool) (nextFetch, error) {
	res, err := w.backend.MoveToDelayed(ctx, job.ID, job.token, delay, MoveToDelayedOptions{
		Failure:      failure,
		FetchNext:    fetchNext,
		LockDuration: w.opts.LockDuration,
		WorkerName:   w.opts.Name,
		Limiter:      w.opts.Limiter,
	})
	if err != nil {
		return nextFetch{}, err
	}
	// The backend increments the attempts counter; mirror it locally only
	// once the transition has succeeded so retried transitions don't drift
	// the counter.
	job.Delay = max(delay.Milliseconds(), 0)
	job.AttemptsMade++
	if !fetchNext {
		return nextFetch{}, nil
	}
	return nextFetch{res: res, delayed: true}, nil
}

// backoffDelay computes how long to wait before the next attempt. A negative
// delay means the job should not be retried. A non-nil error is returned when
// the job uses a custom backoff type and no BackoffStrategy is configured,
// matching the reference implementations, which reject unknown strategies.
func (w *Worker) backoffDelay(job *Job, cause error) (time.Duration, error) {
	var backoff *Backoff
	if job.Opts != nil {
		backoff = job.Opts.Backoff
	}
	if backoff == nil {
		return 0, nil
	}
	attempts := job.AttemptsMade + 1
	switch backoff.Type {
	case BackoffFixed, BackoffExponential:
		// Jobs loaded from other ports are not validated on the way in.
		if err := backoff.validate(); err != nil {
			return 0, err
		}
		maxDelay := float64(backoff.Delay)
		if backoff.Type == BackoffExponential {
			maxDelay = math.Round(math.Pow(2, float64(attempts-1)) * maxDelay)
		}
		ms := maxDelay
		if backoff.Jitter > 0 {
			// Uniform in [maxDelay*(1-jitter), maxDelay), as in the Node.js
			// implementation.
			ms = math.Floor(rand.Float64()*maxDelay*backoff.Jitter + maxDelay*(1-backoff.Jitter))
		}
		return time.Duration(ms) * time.Millisecond, nil
	default:
		if w.opts.BackoffStrategy == nil {
			return 0, configError("unknown backoff strategy %q for job %s; if a custom backoff strategy is used, set WorkerOptions.BackoffStrategy",
				backoff.Type, job.ID)
		}
		ms := w.opts.BackoffStrategy(attempts, backoff.Type, cause, job)
		if ms < 0 {
			return -1, nil
		}
		return time.Duration(ms) * time.Millisecond, nil
	}
}

// newFailureInfo builds the failure recorded for the current attempt: the
// previous traces plus this reason, trimmed to the job's StackTraceLimit.
func newFailureInfo(job *Job, reason string) FailureInfo {
	trace := append(append([]string(nil), job.Stacktrace...), reason)
	if job.Opts != nil && job.Opts.StackTraceLimit != nil {
		if limit := *job.Opts.StackTraceLimit; limit >= 0 && int64(len(trace)) > limit {
			trace = trace[int64(len(trace))-limit:]
		}
	}
	return FailureInfo{Reason: reason, Stacktrace: trace}
}

// finishOptions resolves the settings needed to move job to a finished state:
// the removal policy of the job overrides the worker default.
func (w *Worker) finishOptions(job *Job, target JobState) FinishOptions {
	keep := w.opts.RemoveOnComplete
	if target == StateFailed {
		keep = w.opts.RemoveOnFail
	}
	if job.Opts != nil {
		if target == StateCompleted && job.Opts.RemoveOnComplete != nil {
			keep = job.Opts.RemoveOnComplete
		}
		if target == StateFailed && job.Opts.RemoveOnFail != nil {
			keep = job.Opts.RemoveOnFail
		}
	}
	return FinishOptions{
		Token:        job.token,
		JobOpts:      job.Opts,
		KeepJobs:     keep,
		LockDuration: w.opts.LockDuration,
		WorkerName:   w.opts.Name,
		Limiter:      w.opts.Limiter,
		Metrics:      w.opts.Metrics,
	}
}

// lockRenewalLoop periodically extends the locks of all active jobs.
//
// All locks are renewed with a single extendLocks script call per tick, so the
// time spent renewing does not grow with the number of active jobs, and each
// call is bounded by LockRenewTime so a slow Redis cannot delay the next tick
// past the renewal interval.
func (w *Worker) lockRenewalLoop(ctx context.Context) {
	ticker := time.NewTicker(w.opts.LockRenewTime)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		w.mu.Lock()
		snapshot := make([]*activeJob, 0, len(w.active))
		for _, a := range w.active {
			// A job without a token holds no lock to renew, and one whose
			// lock was already lost has nothing left to renew either.
			if a.job.token != "" && !a.lockLost {
				snapshot = append(snapshot, a)
			}
		}
		w.mu.Unlock()

		if len(snapshot) == 0 {
			continue
		}

		callCtx, cancel := context.WithTimeout(ctx, w.opts.LockRenewTime)
		failed, err := w.extendLocks(callCtx, snapshot)
		cancel()
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			// Transient error (e.g. network blip or timeout): keep the jobs
			// running and just report it; the next tick retries.
			w.emitError(err)
			continue
		}

		var lost []string
		for _, id := range failed {
			w.mu.Lock()
			current, ok := w.active[id]
			// Skip jobs that finished, or were replaced, since the snapshot,
			// and those already reported as lock-lost.
			if ok && current.lockLost {
				ok = false
			}
			if ok {
				ok = snapshotContains(snapshot, current)
			}
			if ok {
				current.lockLost = true
			}
			w.mu.Unlock()
			if !ok {
				continue
			}
			// The lock is gone: another worker may own the job now, so stop
			// processing it locally.
			current.cancel(ErrLockLost)
			lost = append(lost, id)
		}
		if len(lost) > 0 {
			w.emit(Event{Type: EventLockRenewalFailed, JobIDs: lost})
			for _, id := range lost {
				w.emitError(fmt.Errorf("bullmq: could not renew the lock of job %s: %w", id, ErrLockLost))
			}
		}
		if renewed := renewedIDs(snapshot, failed); len(renewed) > 0 {
			w.emit(Event{Type: EventLocksRenewed, JobIDs: renewed})
		}
	}
}

// renewedIDs returns the ids of the snapshot jobs that are not in failed.
func renewedIDs(snapshot []*activeJob, failed []string) []string {
	ids := make([]string, 0, len(snapshot))
	for _, a := range snapshot {
		if !slices.Contains(failed, a.job.ID) {
			ids = append(ids, a.job.ID)
		}
	}
	return ids
}

func snapshotContains(snapshot []*activeJob, a *activeJob) bool {
	for _, s := range snapshot {
		if s == a {
			return true
		}
	}
	return false
}

// extendLocks renews the locks of the given jobs with one backend call and
// returns the ids whose lock could not be renewed (missing or owned by
// another token).
func (w *Worker) extendLocks(ctx context.Context, jobs []*activeJob) ([]string, error) {
	locks := make([]JobLock, 0, len(jobs))
	for _, a := range jobs {
		locks = append(locks, JobLock{JobID: a.job.ID, Token: a.job.token})
	}
	return w.backend.ExtendLocks(ctx, locks, w.opts.LockDuration)
}

// stalledCheckLoop moves jobs whose lock expired back to the wait list. It
// scans immediately on start, so expired locks present at startup are
// recovered right away, and then again after every StalledInterval.
func (w *Worker) stalledCheckLoop(ctx context.Context) {
	for {
		if err := w.checkStalledJobs(ctx); err != nil && ctx.Err() == nil {
			w.emitError(err)
		}
		if !sleepCtx(ctx, w.opts.StalledInterval) {
			return
		}
	}
}

func (w *Worker) checkStalledJobs(ctx context.Context) error {
	ids, err := w.backend.MoveStalledJobsToWait(ctx, StalledOptions{
		MaxStalledCount: w.opts.maxStalledCountVal(),
		Interval:        w.opts.StalledInterval,
	})
	if err != nil {
		return err
	}
	for _, id := range ids {
		w.emit(Event{Type: EventStalled, Job: &Job{ID: id, backend: w.backend, QueueName: w.backend.QueueName()}})
	}
	return nil
}

// Close stops the worker and waits for in-flight jobs to finish. It is safe to
// call more than once and from several goroutines; every call returns the same
// result.
func (w *Worker) Close() error {
	w.closeOnce.Do(func() {
		w.stopOnce.Do(func() { close(w.stop) })
		// runOnce is shared with Run: sync.Once.Do blocks concurrent callers
		// until an in-progress call's function returns, and Run's function
		// spans the entire run() lifecycle. So this call either waits for an
		// already-running Run to fully stop (its function only returns once
		// run() does, after the stop signal above has been observed), or, if
		// Run was never called, claims the once itself so any later Run call
		// observes it as already closed and never touches the resources
		// below. Either way, it is safe to close them once this returns.
		w.runOnce.Do(func() {})
		w.closeErr = w.backend.Close()
		w.eventsMu.Lock()
		w.eventsClosed = true
		close(w.events)
		w.eventsMu.Unlock()
	})
	return w.closeErr
}

// emit publishes ev to OnEvent and the Events channel. Events emitted once
// the worker is closed, for example progress reported by a goroutine that
// outlived its job, are discarded.
func (w *Worker) emit(ev Event) {
	w.eventsMu.RLock()
	closed := w.eventsClosed
	w.eventsMu.RUnlock()
	if closed {
		return
	}
	// The callback runs without the lock held, so it may emit events itself
	// (for example by updating a job's progress).
	if onEvent := w.opts.OnEvent; onEvent != nil {
		onEvent(ev)
	}
	w.eventsMu.RLock()
	defer w.eventsMu.RUnlock()
	if w.eventsClosed {
		return
	}
	select {
	case w.events <- ev:
	default:
		w.droppedEvents.Add(1)
	}
}

func (w *Worker) emitError(err error) {
	if err == nil {
		return
	}
	// The callback runs on its own goroutine: Run waits for the fetch, renewal
	// and stalled-check goroutines that call emitError, and Close waits for
	// Run, so a synchronous callback that calls Close (the natural recovery
	// action) would deadlock.
	if onError := w.opts.OnError; onError != nil {
		go onError(err)
	}
	w.emit(Event{Type: EventError, Err: err})
}
