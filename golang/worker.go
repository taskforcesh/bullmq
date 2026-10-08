package bullmq

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"runtime/debug"
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
type Processor func(ctx context.Context, job *Job) (any, error)

// EventType identifies a worker lifecycle event.
type EventType string

// Worker event types.
const (
	EventActive    EventType = "active"
	EventCompleted EventType = "completed"
	EventFailed    EventType = "failed"
	EventProgress  EventType = "progress"
	EventStalled   EventType = "stalled"
	EventDrained   EventType = "drained"
	EventError     EventType = "error"
	EventClosed    EventType = "closed"
)

// Event is emitted by a Worker through Worker.Events.
type Event struct {
	// Type is the kind of event.
	Type EventType
	// Job is the job the event refers to; nil for EventDrained, EventError and
	// EventClosed.
	Job *Job
	// Result is the processor return value for EventCompleted, or the new
	// Progress value for EventProgress.
	Result any
	// Err carries the failure for EventFailed and EventError.
	Err error
}

// Worker fetches jobs from a queue and hands them to a Processor.
type Worker struct {
	backend Backend
	opts    WorkerOptions
	proc    Processor

	id     string
	tokens atomic.Uint64

	events chan Event

	runOnce   sync.Once
	stopOnce  sync.Once
	closeOnce sync.Once
	closeErr  error
	stop      chan struct{}
	wg        sync.WaitGroup

	paused atomic.Bool

	mu     sync.Mutex
	active map[string]*activeJob
}

type activeJob struct {
	job    *Job
	cancel context.CancelFunc
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

	backend, err := resolveBackend(o.Backend, o.Redis, queueName, BackendOptions{
		Prefix:                 o.Prefix,
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
		active:  make(map[string]*activeJob),
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

// Events returns the channel on which lifecycle events are published.
//
// The channel is buffered; events are dropped when the consumer falls behind,
// so a worker never blocks on event delivery.
func (w *Worker) Events() <-chan Event { return w.events }

// Pause stops fetching new jobs. Jobs already active keep running.
func (w *Worker) Pause() { w.paused.Store(true) }

// Resume restarts fetching jobs after Pause.
func (w *Worker) Resume() { w.paused.Store(false) }

// IsPaused reports whether the worker is paused.
func (w *Worker) IsPaused() bool { return w.paused.Load() }

// ActiveCount returns how many jobs are currently being processed.
func (w *Worker) ActiveCount() int {
	w.mu.Lock()
	defer w.mu.Unlock()
	return len(w.active)
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

// fetchLoop is the single driver that moves jobs to active and dispatches them
// to processing goroutines, keeping at most Concurrency jobs in flight.
//
// loopCtx controls fetching: it is cancelled by Close so the loop stops
// pulling new jobs. jobCtx is handed to processJob for already-dispatched
// jobs; it is only cancelled by the caller (never by Close), so a graceful
// shutdown drains in-flight jobs instead of cancelling them.
func (w *Worker) fetchLoop(loopCtx, jobCtx context.Context) error {
	slots := make(chan struct{}, w.opts.Concurrency)
	for range w.opts.Concurrency {
		slots <- struct{}{}
	}
	var processing sync.WaitGroup
	defer processing.Wait()

	drained := false

	for {
		select {
		case <-loopCtx.Done():
			return loopCtx.Err()
		case <-slots:
		}

		if w.IsPaused() {
			slots <- struct{}{}
			if !sleepCtx(loopCtx, 100*time.Millisecond) {
				return loopCtx.Err()
			}
			continue
		}

		job, waitFor, err := w.moveToActive(loopCtx)
		if err != nil {
			slots <- struct{}{}
			if loopCtx.Err() != nil {
				return loopCtx.Err()
			}
			w.emitError(err)
			if !sleepCtx(loopCtx, 5*time.Second) {
				return loopCtx.Err()
			}
			continue
		}

		if job == nil {
			slots <- struct{}{}
			if !drained {
				drained = true
				w.emit(Event{Type: EventDrained})
			}
			if !w.waitForJob(loopCtx, waitFor) {
				return loopCtx.Err()
			}
			continue
		}

		drained = false
		processing.Add(1)
		go func(job *Job) {
			defer processing.Done()
			defer func() { slots <- struct{}{} }()
			w.processJob(jobCtx, job)
		}(job)
	}
}

// waitForJob blocks until a job shows up, a delayed job comes due, or the
// drain delay elapses.
func (w *Worker) waitForJob(ctx context.Context, waitFor time.Duration) bool {
	timeout := w.opts.DrainDelay
	if waitFor > 0 && waitFor < timeout {
		timeout = waitFor
	}
	if err := w.backend.WaitForJob(ctx, timeout); err != nil {
		if ctx.Err() != nil {
			return false
		}
		w.emitError(err)
		return sleepCtx(ctx, time.Second)
	}
	return ctx.Err() == nil
}

// moveToActive atomically moves the next job to the active list and locks it.
// It returns (nil, delay, nil) when no job is available; delay is how long to
// wait before the next attempt (rate limit or next delayed job).
func (w *Worker) moveToActive(ctx context.Context) (*Job, time.Duration, error) {
	token := w.nextToken()
	res, err := w.backend.MoveToActive(ctx, MoveToActiveOptions{
		Token:        token,
		LockDuration: w.opts.LockDuration,
		WorkerName:   w.opts.Name,
		Limiter:      w.opts.Limiter,
	})
	if err != nil {
		return nil, 0, err
	}
	if res == nil || res.Job == nil {
		var wait time.Duration
		if res != nil {
			wait = res.Wait
		}
		return nil, wait, nil
	}
	job := newJob(w.backend, res.Job)
	job.token = token
	job.lockDuration = w.opts.LockDuration
	job.worker = w
	return job, 0, nil
}

func (w *Worker) nextToken() string {
	return w.id + ":" + strconv.FormatUint(w.tokens.Add(1), 10)
}

// processJob runs the processor and moves the job to its finished state.
func (w *Worker) processJob(ctx context.Context, job *Job) {
	jobCtx, cancel := context.WithCancel(ctx)
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
		job.worker = nil
		cancel()
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
	if job.DeferredFailure != "" {
		// The stalled-check script found this job exceeded MaxStalledCount and
		// stored the reason in "defa" instead of failing it outright, so it
		// must be failed unrecoverably here rather than handed to the processor.
		err = &UnrecoverableError{Message: job.DeferredFailure}
	} else {
		result, err = w.safeProcess(jobCtx, job)
	}

	// The processor took ownership of the job's next state.
	if errors.Is(err, ErrDelayed) || errors.Is(err, ErrWaitingChildren) {
		return
	}

	// moveToFailed appends to job.Stacktrace, so restore it before every
	// attempt to keep retried transitions from duplicating entries.
	baseTrace := job.Stacktrace
	fail := func(cause error) {
		ferr := w.retryTransition(ctx, func(c context.Context) error {
			job.Stacktrace = baseTrace
			return w.moveToFailed(c, job, cause)
		})
		if ferr != nil {
			w.emitError(ferr)
			return
		}
		w.emit(Event{Type: EventFailed, Job: job, Err: cause})
	}

	if err != nil {
		fail(err)
		return
	}

	// A result that cannot be encoded is a genuine job failure, unlike an
	// error from the completion transition below.
	raw, merr := json.Marshal(result)
	if merr != nil {
		fail(merr)
		return
	}

	// The processor succeeded, so a failure to record that is never turned
	// into a job failure: transient Redis errors are retried, and anything
	// else (e.g. the lock was lost) is reported and left to the stalled check.
	if cerr := w.retryTransition(ctx, func(c context.Context) error {
		return w.moveToCompleted(c, job, raw)
	}); cerr != nil {
		w.emitError(cerr)
		return
	}
	w.emit(Event{Type: EventCompleted, Job: job, Result: result})
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

func (w *Worker) moveToCompleted(ctx context.Context, job *Job, raw []byte) error {
	finishedOn, err := w.backend.MoveToCompleted(ctx, job.ID, raw, w.finishOptions(job, StateCompleted))
	if err != nil {
		return err
	}
	job.ReturnValue = raw
	job.FinishedOn = finishedOn
	job.AttemptsMade++
	return nil
}

func (w *Worker) moveToFailed(ctx context.Context, job *Job, cause error) error {
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
		case delay >= 0:
			return w.retryJob(ctx, job, delay, &failure)
		}
	}

	finishedOn, err := w.backend.MoveToFailed(ctx, job.ID, failure, w.finishOptions(job, StateFailed))
	if err != nil {
		return err
	}
	job.FinishedOn = finishedOn
	job.AttemptsMade++
	return nil
}

// retryJob puts a failed job back into the wait list, either immediately or
// after the backoff delay.
func (w *Worker) retryJob(ctx context.Context, job *Job, delay time.Duration, failure *FailureInfo) error {
	var err error
	if delay > 0 {
		err = job.moveToDelayed(ctx, delay, false, failure)
	} else {
		err = w.backend.RetryJob(ctx, job.ID, job.token, job.Opts.isLIFO(), failure)
	}
	if err != nil {
		return err
	}
	// Both operations increment the attempts counter in the backend; mirror it locally only once the
	// transition has succeeded so failed attempts that are retried don't
	// drift the counter.
	job.AttemptsMade++
	return nil
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
// previous traces plus this reason, trimmed to the last 10 entries.
func newFailureInfo(job *Job, reason string) FailureInfo {
	trace := append(append([]string(nil), job.Stacktrace...), reason)
	if len(trace) > 10 {
		trace = trace[len(trace)-10:]
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
			// A job without a token holds no lock to renew.
			if a.job.token != "" {
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

		for _, id := range failed {
			w.mu.Lock()
			current, ok := w.active[id]
			w.mu.Unlock()
			// Skip jobs that finished, or were replaced, since the snapshot.
			if !ok || !snapshotContains(snapshot, current) {
				continue
			}
			// The lock is gone: another worker owns the job now, so stop
			// processing it locally.
			current.cancel()
			w.emit(Event{Type: EventStalled, Job: current.job})
		}
	}
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
		close(w.events)
	})
	return w.closeErr
}

func (w *Worker) emit(ev Event) {
	select {
	case w.events <- ev:
	default:
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
