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
	// Result is the processor return value for EventCompleted.
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
	ran       atomic.Bool
	stop      chan struct{}
	done      chan struct{}
	wg        sync.WaitGroup

	paused atomic.Bool

	mu     sync.Mutex
	active map[string]*activeJob

	// blocking is a dedicated connection used for BZPOPMIN so that a blocked
	// read never starves the shared pool.
	blocking      redis.UniversalClient
	blockingOwned bool
}

type activeJob struct {
	job    *Job
	cancel context.CancelFunc
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
	o.applyDefaults()

	c, err := newClient(queueName, o.Prefix, o.Redis)
	if err != nil {
		return nil, err
	}

	blocking, blockingOwned := o.Redis.build()

	w := &Worker{
		c:             c,
		opts:          o,
		proc:          proc,
		id:            randomID(),
		events:        make(chan Event, 256),
		stop:          make(chan struct{}),
		done:          make(chan struct{}),
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
		w.ran.Store(true)
		err = w.run(ctx)
	})
	if !started {
		return ErrWorkerClosed
	}
	return err
}

func (w *Worker) run(ctx context.Context) error {
	defer close(w.done)

	name := w.c.keys.ClientName(":w:" + w.id)
	if e := w.blocking.Do(ctx, "client", "setname", name).Err(); e != nil {
		w.emitError(fmt.Errorf("bullmq: unable to set client name: %w", e))
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		select {
		case <-w.stop:
			cancel()
		case <-ctx.Done():
		}
	}()

	if !w.opts.SkipStalledCheck {
		w.wg.Add(1)
		go func() {
			defer w.wg.Done()
			w.stalledCheckLoop(ctx)
		}()
	}
	if !w.opts.SkipLockRenewal {
		w.wg.Add(1)
		go func() {
			defer w.wg.Done()
			w.lockRenewalLoop(ctx)
		}()
	}

	err := w.fetchLoop(ctx)

	w.wg.Wait()
	w.emit(Event{Type: EventClosed})
	return err
}

// fetchLoop is the single driver that moves jobs to active and dispatches them
// to processing goroutines, keeping at most Concurrency jobs in flight.
func (w *Worker) fetchLoop(ctx context.Context) error {
	slots := make(chan struct{}, w.opts.Concurrency)
	for range w.opts.Concurrency {
		slots <- struct{}{}
	}
	var processing sync.WaitGroup
	defer processing.Wait()

	drained := false

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-slots:
		}

		if w.IsPaused() {
			slots <- struct{}{}
			if !sleepCtx(ctx, 100*time.Millisecond) {
				return ctx.Err()
			}
			continue
		}

		job, waitFor, err := w.moveToActive(ctx)
		if err != nil {
			slots <- struct{}{}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			w.emitError(err)
			if !sleepCtx(ctx, 5*time.Second) {
				return ctx.Err()
			}
			continue
		}

		if job == nil {
			slots <- struct{}{}
			if !drained {
				drained = true
				w.emit(Event{Type: EventDrained})
			}
			if !w.waitForJob(ctx, waitFor) {
				return ctx.Err()
			}
			continue
		}

		drained = false
		processing.Add(1)
		go func(job *Job) {
			defer processing.Done()
			defer func() { slots <- struct{}{} }()
			w.processJob(ctx, job)
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
	w.mu.Lock()
	w.active[job.ID] = &activeJob{job: job, cancel: cancel}
	w.mu.Unlock()
	defer func() {
		w.mu.Lock()
		delete(w.active, job.ID)
		w.mu.Unlock()
		cancel()
	}()

	w.emit(Event{Type: EventActive, Job: job})

	result, err := w.safeProcess(jobCtx, job)

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
		}
		w.emit(Event{Type: EventFailed, Job: job, Err: err})
		return
	}

	if cerr := w.moveToCompleted(finishCtx, job, result); cerr != nil {
		w.emitError(cerr)
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
		raw = []byte("null")
	}
	_, err = w.moveToFinished(ctx, job, "completed", "returnvalue", string(raw))
	if err == nil {
		job.ReturnValue = raw
	}
	return err
}

func (w *Worker) moveToFailed(ctx context.Context, job *Job, cause error) error {
	reason := cause.Error()

	if err := w.saveStacktrace(ctx, job, reason); err != nil {
		w.emitError(err)
	}

	attempts := int64(0)
	if job.Opts != nil {
		attempts = job.Opts.Attempts
	}
	retriesLeft := !job.discarded &&
		!IsUnrecoverable(cause) &&
		job.AttemptsMade+1 < attempts

	if retriesLeft {
		delay := w.backoffDelay(job, cause)
		if delay >= 0 {
			return w.retryJob(ctx, job, delay)
		}
	}

	_, err := w.moveToFinished(ctx, job, "failed", "failedReason", reason)
	return err
}

// retryJob puts a failed job back into the wait list, either immediately or
// after the backoff delay.
func (w *Worker) retryJob(ctx context.Context, job *Job, delay time.Duration) error {
	if delay > 0 {
		return job.moveToDelayed(ctx, delay, false)
	}
	pushCmd := "RPUSH"
	if job.Opts != nil && job.Opts.LIFO {
		pushCmd = "LPUSH"
	}
	k := w.c.keys
	return w.c.runScriptStatus(ctx, "retryJob", []string{
		k.Active(), k.Wait(), k.Paused(), k.Job(job.ID), k.Meta(), k.Events(),
		k.Delayed(), k.Prioritized(), k.PC(), k.Marker(), k.Stalled(),
	}, k.KeyPrefix(), nowMillis(), pushCmd, job.ID, job.token, "")
}

// backoffDelay computes how long to wait before the next attempt. A negative
// result means the job should not be retried.
func (w *Worker) backoffDelay(job *Job, cause error) time.Duration {
	var backoff *Backoff
	if job.Opts != nil {
		backoff = job.Opts.Backoff
	}
	if backoff == nil {
		return 0
	}
	attempts := job.AttemptsMade + 1
	switch backoff.Type {
	case BackoffFixed:
		return time.Duration(backoff.Delay) * time.Millisecond
	case BackoffExponential:
		factor := math.Pow(2, float64(attempts-1))
		return time.Duration(float64(backoff.Delay)*factor) * time.Millisecond
	default:
		if w.opts.BackoffStrategy == nil {
			return 0
		}
		ms := w.opts.BackoffStrategy(attempts, backoff.Type, cause, job)
		if ms < 0 {
			return -1
		}
		return time.Duration(ms) * time.Millisecond
	}
}

func (w *Worker) saveStacktrace(ctx context.Context, job *Job, reason string) error {
	trace := append(job.Stacktrace, reason)
	if len(trace) > 10 {
		trace = trace[len(trace)-10:]
	}
	raw, err := json.Marshal(trace)
	if err != nil {
		return err
	}
	job.Stacktrace = trace
	job.FailedReason = reason
	return w.c.runScriptStatus(ctx, "saveStacktrace",
		[]string{w.c.keys.Job(job.ID)}, string(raw), reason)
}

// moveToFinished moves an active job into the completed or failed set.
func (w *Worker) moveToFinished(ctx context.Context, job *Job, target, field, value string) (any, error) {
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
		"", // no extra fields to update
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
		attempts = job.Opts.Attempts
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
	mp.Bool(opts.FailParentOnFailure)
	mp.Str("cpof")
	mp.Bool(opts.ContinueParentOnFailure)
	mp.Str("idof")
	mp.Bool(opts.IgnoreDependencyOnFailure)
	mp.Str("rdof")
	mp.Bool(opts.RemoveDependencyOnFailure)
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
			snapshot = append(snapshot, a)
		}
		w.mu.Unlock()

		for _, a := range snapshot {
			if err := a.job.ExtendLock(ctx, w.opts.LockDuration); err != nil {
				if ctx.Err() != nil {
					return
				}
				// The lock is gone: another worker owns the job now, so stop
				// processing it locally.
				a.cancel()
				w.emit(Event{Type: EventStalled, Job: a.job})
			}
		}
	}
}

// stalledCheckLoop moves jobs whose lock expired back to the wait list.
func (w *Worker) stalledCheckLoop(ctx context.Context) {
	ticker := time.NewTicker(w.opts.StalledInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		if err := w.checkStalledJobs(ctx); err != nil && ctx.Err() == nil {
			w.emitError(err)
		}
	}
}

func (w *Worker) checkStalledJobs(ctx context.Context) error {
	k := w.c.keys
	res, err := w.c.runScript(ctx, "moveStalledJobsToWait", []string{
		k.Stalled(), k.Wait(), k.Active(), k.StalledCheck(), k.Meta(),
		k.Paused(), k.Marker(), k.Events(), k.Repeat(),
	},
		w.opts.MaxStalledCount,
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
	stalled, _ := arr[0].([]any)
	for _, v := range stalled {
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
		if w.ran.Load() {
			<-w.done
		}
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
	if w.opts.OnError != nil {
		w.opts.OnError(err)
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
