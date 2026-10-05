package bullmq

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"runtime/debug"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
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
	// Job is the job the event refers to; nil for EventDrained and EventError.
	Job *Job
	// Result is the processor return value for EventCompleted, or the new
	// Progress value for EventProgress.
	Result any
	// Err carries the failure for EventFailed and EventError.
	Err error
}

// Worker fetches jobs from a queue and hands them to a Processor.
type Worker struct {
	c    *client
	opts WorkerOptions
	proc Processor

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

	// blocking is a dedicated single-connection client used for BZPOPMIN so
	// that a blocked read never starves the shared pool, and so CLIENT
	// SETNAME (set via RedisOptions.buildBlocking's OnConnect hook) reliably
	// applies to the connection BZPOPMIN actually runs on.
	blocking      redis.UniversalClient
	blockingOwned bool
}

type activeJob struct {
	job    *Job
	cancel context.CancelFunc
}

// blockingClientName returns the CLIENT SETNAME value for a worker's blocking
// connection: the bare queue client name when no explicit WorkerOptions.Name
// is configured (matching Queue.Workers' "unnamed" check and the other BullMQ
// ports), or "<clientName>:w:<name>" when one is set. It intentionally does
// not fall back to the worker's internally generated id, since that would
// make every worker appear "named" and diverge from the other ports.
func blockingClientName(c *client, name string) string {
	if name == "" {
		return c.keys.ClientName("")
	}
	return c.keys.ClientName(":w:" + name)
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

	c, err := newClient(queueName, o.Prefix, o.Redis)
	if err != nil {
		return nil, err
	}

	id := randomID()
	blocking, blockingOwned := o.Redis.buildBlocking(blockingClientName(c, o.Name))

	w := &Worker{
		c:             c,
		opts:          o,
		proc:          proc,
		id:            id,
		events:        make(chan Event, 256),
		stop:          make(chan struct{}),
		active:        make(map[string]*activeJob),
		blocking:      blocking,
		blockingOwned: blockingOwned,
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
	if !w.blockingOwned {
		// A caller-supplied client is (potentially) shared/pooled; naming it
		// here is best-effort only; see RedisOptions.buildBlocking. Our own
		// dedicated blocking client is already named via its OnConnect hook,
		// on the exact connection BZPOPMIN will use.
		name := blockingClientName(w.c, w.opts.Name)
		if e := w.blocking.Do(ctx, "client", "setname", name).Err(); e != nil {
			w.emitError(fmt.Errorf("bullmq: unable to set client name: %w", e))
		}
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

// waitForJob blocks on the marker key until a job shows up, a delayed job comes
// due, or the drain delay elapses.
func (w *Worker) waitForJob(ctx context.Context, waitFor time.Duration) bool {
	timeout := w.opts.DrainDelay
	if waitFor > 0 && waitFor < timeout {
		timeout = waitFor
	}
	if timeout < time.Millisecond {
		timeout = time.Millisecond
	}
	// BZPOPMIN is issued through Do so that sub-second timeouts are preserved;
	// the typed helper in go-redis rounds them up to a full second.
	err := w.blocking.Do(ctx, "bzpopmin", w.c.keys.Marker(), timeout.Seconds()).Err()
	if err != nil && err != redis.Nil && ctx.Err() == nil {
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
	res, err := w.c.runScript(ctx, "moveToActive", w.moveToActiveKeys(),
		w.c.keys.KeyPrefix(), nowMillis(), w.packMoveToActiveOpts(token))
	if err != nil {
		return nil, 0, err
	}
	return w.parseFetchResult(res, token)
}

func (w *Worker) moveToActiveKeys() []string {
	k := w.c.keys
	return []string{
		k.Wait(), k.Active(), k.Prioritized(), k.Events(), k.Stalled(),
		k.Limiter(), k.Delayed(), k.Paused(), k.Meta(), k.PC(), k.Marker(),
	}
}

// parseFetchResult decodes the `{jobData, jobId, limitUntil, delayUntil}` reply
// shared by moveToActive and the fetch-next branch of moveToFinished.
func (w *Worker) parseFetchResult(res any, token string) (*Job, time.Duration, error) {
	arr, ok := res.([]any)
	if !ok || len(arr) < 2 {
		return nil, 0, nil
	}
	fields := flatToMap(arr[0])
	jobID, _ := asString(arr[1])
	if len(fields) == 0 || jobID == "" {
		var wait time.Duration
		if len(arr) > 2 {
			if ms, _ := asInt64(arr[2]); ms > 0 {
				wait = time.Duration(ms) * time.Millisecond
			}
		}
		if len(arr) > 3 && wait == 0 {
			if ts, _ := asInt64(arr[3]); ts > 0 {
				if d := time.Until(time.UnixMilli(ts)); d > 0 {
					wait = d
				}
			}
		}
		return nil, wait, nil
	}
	job := jobFromHash(w.c, jobID, fields)
	job.token = token
	job.lockDuration = w.opts.LockDuration
	job.worker = w
	return job, 0, nil
}

func (w *Worker) nextToken() string {
	return w.id + ":" + strconv.FormatUint(w.tokens.Add(1), 10)
}

func (w *Worker) packMoveToActiveOpts(token string) []byte {
	n := 2
	if w.opts.Name != "" {
		n++
	}
	if w.opts.Limiter != nil {
		n++
	}
	mp := newMsgpackWriter(96)
	mp.MapLen(n)
	mp.Str("token")
	mp.Str(token)
	mp.Str("lockDuration")
	mp.Uint(uint64(w.opts.LockDuration.Milliseconds()))
	if w.opts.Name != "" {
		mp.Str("name")
		mp.Str(w.opts.Name)
	}
	if l := w.opts.Limiter; l != nil {
		mp.Str("limiter")
		l.writeMsgpack(mp)
	}
	return mp.Bytes()
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
			"bullmq: job %s was produced by job scheduler %q; the Go worker cannot advance job schedulers, so no further iteration will be scheduled unless another scheduler-capable worker also consumes this queue",
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

	// Use the parent context so that a cancelled job still gets reported.
	finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer finishCancel()

	if err != nil {
		if ferr := w.moveToFailed(finishCtx, job, err); ferr != nil {
			w.emitError(ferr)
			return
		}
		w.emit(Event{Type: EventFailed, Job: job, Err: err})
		return
	}

	if cerr := w.moveToCompleted(finishCtx, job, result); cerr != nil {
		if ferr := w.moveToFailed(finishCtx, job, cerr); ferr != nil {
			w.emitError(ferr)
			return
		}
		w.emit(Event{Type: EventFailed, Job: job, Err: cerr})
		return
	}
	w.emit(Event{Type: EventCompleted, Job: job, Result: result})
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

func (w *Worker) moveToCompleted(ctx context.Context, job *Job, result any) error {
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	_, err = w.moveToFinished(ctx, job, "completed", "returnvalue", string(raw), nil)
	if err == nil {
		job.ReturnValue = raw
	}
	return err
}

func (w *Worker) moveToFailed(ctx context.Context, job *Job, cause error) error {
	reason := cause.Error()
	fieldsToUpdate, stacktrace := packFailureFields(job, reason)
	job.FailedReason = reason
	job.Stacktrace = stacktrace

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
			return w.retryJob(ctx, job, delay, fieldsToUpdate)
		}
	}

	_, err := w.moveToFinished(ctx, job, "failed", "failedReason", reason, fieldsToUpdate)
	return err
}

// retryJob puts a failed job back into the wait list, either immediately or
// after the backoff delay.
func (w *Worker) retryJob(ctx context.Context, job *Job, delay time.Duration, fieldsToUpdate []byte) error {
	if delay > 0 {
		return job.moveToDelayed(ctx, delay, false, fieldsToUpdate)
	}
	pushCmd := "LPUSH"
	if job.Opts.isLIFO() {
		pushCmd = "RPUSH"
	}
	k := w.c.keys
	return w.c.runScriptStatus(ctx, "retryJob", []string{
		k.Active(), k.Wait(), k.Paused(), k.Job(job.ID), k.Meta(), k.Events(),
		k.Delayed(), k.Prioritized(), k.PC(), k.Marker(), k.Stalled(),
	}, k.KeyPrefix(), nowMillis(), pushCmd, job.ID, job.token, fieldsArg(fieldsToUpdate))
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
	case BackoffFixed:
		return time.Duration(backoff.Delay) * time.Millisecond, nil
	case BackoffExponential:
		factor := math.Pow(2, float64(attempts-1))
		return time.Duration(float64(backoff.Delay)*factor) * time.Millisecond, nil
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

func packFailureFields(job *Job, reason string) ([]byte, []string) {
	trace := append(append([]string(nil), job.Stacktrace...), reason)
	if len(trace) > 10 {
		trace = trace[len(trace)-10:]
	}
	raw, _ := json.Marshal(trace)
	fields := newMsgpackWriter(len(reason) + len(raw) + 32)
	fields.ArrayLen(4)
	fields.Str("failedReason")
	fields.Str(reason)
	fields.Str("stacktrace")
	fields.Str(string(raw))
	return fields.Bytes(), trace
}

func fieldsArg(fields []byte) any {
	if len(fields) == 0 {
		return ""
	}
	return fields
}

// moveToFinished moves an active job into the completed or failed set.
func (w *Worker) moveToFinished(ctx context.Context, job *Job, target, field, value string, fieldsToUpdate []byte) (any, error) {
	k := w.c.keys
	keys := []string{
		k.Wait(), k.Active(), k.Prioritized(), k.Events(), k.Stalled(),
		k.Limiter(), k.Delayed(), k.Paused(), k.Meta(), k.PC(),
		k.Get(target), k.Job(job.ID), k.Metrics(target), k.Marker(),
	}

	res, err := w.c.runScript(ctx, "moveToFinished", keys,
		job.ID, nowMillis(), field, value, target,
		"0", // never fetch the next job here; the fetch loop owns that
		k.KeyPrefix(),
		w.packMoveToFinishedOpts(job, target),
		fieldsArg(fieldsToUpdate),
	)
	if err != nil {
		return nil, err
	}
	if code, ok := asInt64(res); ok && code < 0 {
		return nil, scriptError("moveToFinished", code)
	}
	job.FinishedOn = nowMillis()
	job.AttemptsMade++
	return res, nil
}

func (w *Worker) packMoveToFinishedOpts(job *Job, target string) []byte {
	keep := w.opts.RemoveOnComplete
	if target == "failed" {
		keep = w.opts.RemoveOnFail
	}
	if job.Opts != nil {
		if target == "completed" && job.Opts.RemoveOnComplete != nil {
			keep = job.Opts.RemoveOnComplete
		}
		if target == "failed" && job.Opts.RemoveOnFail != nil {
			keep = job.Opts.RemoveOnFail
		}
	}

	maxMetricsSize := ""
	if w.opts.Metrics != nil && w.opts.Metrics.MaxDataPoints > 0 {
		maxMetricsSize = strconv.FormatInt(w.opts.Metrics.MaxDataPoints, 10)
	}

	attempts := int64(0)
	var opts *JobOptions
	if job.Opts != nil {
		opts = job.Opts
		attempts = job.Opts.attemptsVal()
	} else {
		opts = &JobOptions{}
	}

	n := 9
	if w.opts.Name != "" {
		n++
	}
	if w.opts.Limiter != nil {
		n++
	}

	mp := newMsgpackWriter(192)
	mp.MapLen(n)
	mp.Str("token")
	mp.Str(job.token)
	mp.Str("keepJobs")
	if keep != nil {
		keep.writeMsgpack(mp)
	} else {
		mp.MapLen(0)
	}
	mp.Str("lockDuration")
	mp.Uint(uint64(w.opts.LockDuration.Milliseconds()))
	mp.Str("attempts")
	mp.Uint(uint64(attempts))
	mp.Str("maxMetricsSize")
	mp.Str(maxMetricsSize)
	mp.Str("fpof")
	mp.Bool(opts.failParentOnFailureVal())
	mp.Str("cpof")
	mp.Bool(opts.continueParentOnFailureVal())
	mp.Str("idof")
	mp.Bool(opts.ignoreDependencyOnFailureVal())
	mp.Str("rdof")
	mp.Bool(opts.removeDependencyOnFailureVal())
	if w.opts.Name != "" {
		mp.Str("name")
		mp.Str(w.opts.Name)
	}
	if l := w.opts.Limiter; l != nil {
		mp.Str("limiter")
		l.writeMsgpack(mp)
	}
	return mp.Bytes()
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

// extendLocks renews the locks of the given jobs with one script call and
// returns the ids whose lock could not be renewed (missing or owned by
// another token).
func (w *Worker) extendLocks(ctx context.Context, jobs []*activeJob) ([]string, error) {
	tokens := newMsgpackWriter(16 * len(jobs))
	tokens.ArrayLen(len(jobs))
	ids := newMsgpackWriter(8 * len(jobs))
	ids.ArrayLen(len(jobs))
	for _, a := range jobs {
		tokens.Str(a.job.token)
		ids.Str(a.job.ID)
	}

	k := w.c.keys
	res, err := w.c.runScript(ctx, "extendLocks", []string{k.Stalled()},
		k.KeyPrefix(), tokens.Bytes(), ids.Bytes(), w.opts.LockDuration.Milliseconds())
	if err != nil {
		return nil, err
	}
	arr, _ := res.([]any)
	failed := make([]string, 0, len(arr))
	for _, v := range arr {
		if id, ok := asString(v); ok {
			failed = append(failed, id)
		}
	}
	return failed, nil
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
	k := w.c.keys
	res, err := w.c.runScript(ctx, "moveStalledJobsToWait", []string{
		k.Stalled(), k.Wait(), k.Active(), k.StalledCheck(), k.Meta(),
		k.Paused(), k.Marker(), k.Events(), k.Repeat(),
	},
		w.opts.maxStalledCountVal(),
		k.KeyPrefix(),
		nowMillis(),
		w.opts.StalledInterval.Milliseconds(),
	)
	if err != nil {
		return err
	}
	arr, ok := res.([]any)
	if !ok || len(arr) == 0 {
		return nil
	}
	for _, v := range arr {
		if id, ok := asString(v); ok {
			w.emit(Event{Type: EventStalled, Job: &Job{ID: id, c: w.c, QueueName: w.c.keys.Name()}})
		}
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
		if w.blockingOwned {
			w.closeErr = w.blocking.Close()
		}
		if err := w.c.close(); w.closeErr == nil {
			w.closeErr = err
		}
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

// sleepCtx waits for d, returning false when ctx is cancelled first.
func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}
