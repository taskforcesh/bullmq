package bullmq

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// manualState is the state of a worker without a processor, whose jobs are
// fetched with GetNextJob.
type manualState struct {
	// nameOnce names the worker's dedicated connection, as Run does.
	nameOnce sync.Once
	// waiting holds a token while a GetNextJob call blocks on the
	// worker's dedicated connection, so concurrent calls wait in turn.
	waiting chan struct{}
	// mu orders StartStalledCheck with Close, which waits for wg.
	mu      sync.Mutex
	started bool
	wg      sync.WaitGroup
}

// GetNextJob fetches the next job of a worker without a processor and locks
// it with token, as Node's worker.getNextJob does. It returns nil when no
// job can be fetched: the queue is empty, paused, rate limited or at its
// global concurrency limit, or the worker is paused. When block is set and
// the queue is empty, it waits for a job for up to DrainDelay, fetching
// again whenever the queue signals one or a delayed job is due, or until
// ctx is done or the worker is closed.
//
// The job is locked for LockDuration and its lock is not renewed: finish it
// with Job.MoveToCompleted or Job.MoveToFailed, with the same token, before
// the lock expires, or extend the lock with Job.ExtendLock. A job whose lock
// expires is moved back to wait by the stalled check of any worker (see
// StartStalledCheck), and its token no longer finishes it.
//
// As in Node.js, it emits EventActive for the job and, for the job of a job
// scheduler, first adds the job of the scheduler's next iteration. Jobs
// fetched by hand don't count for Pause and ActiveCount. GetNextJob may be
// called concurrently; calls that block wait in turn. It returns
// [ErrWorkerClosed] once the worker is closed.
func (w *Worker) GetNextJob(ctx context.Context, token string, block bool) (*Job, error) {
	if token == "" {
		return nil, configError("GetNextJob needs a token to lock the job with")
	}
	if w.stopping() {
		return nil, ErrWorkerClosed
	}
	w.nameManualConnection(ctx)
	if w.IsPaused() {
		return nil, nil
	}

	job, res, err := w.manualFetch(ctx, token)
	if err != nil || job != nil || !block || res.RateLimitDelay > 0 {
		return job, err
	}

	// Wait on the dedicated connection, as the worker's loop does once the
	// queue looks drained, and fetch again, until a job is fetched or
	// DrainDelay has passed. A wake-up may be spurious: on Redis, every
	// fetch leaves a marker for the other workers.
	wctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		select {
		case <-w.stop:
			cancel()
		case <-wctx.Done():
		}
	}()
	deadline := time.Now().Add(w.opts.DrainDelay)
	for {
		timeout := time.Until(deadline)
		if next := w.blockUntil.Load(); next > 0 {
			timeout = min(timeout, time.Until(time.UnixMilli(next)))
		}
		if timeout > 0 {
			woken, err := w.manualWait(wctx, timeout)
			if err != nil {
				return nil, w.manualErr(ctx, err)
			}
			if woken.Woken && woken.NextDelayedAt > nowMillis() {
				// A delayed job was scheduled: wait until it is due.
				w.noteNextDelayed(woken.NextDelayedAt)
				continue
			}
		}
		if w.IsPaused() {
			return nil, nil
		}
		job, res, err = w.manualFetch(ctx, token)
		if err != nil || job != nil || res.RateLimitDelay > 0 || !time.Now().Before(deadline) {
			return job, err
		}
	}
}

// manualWait waits for a job on the worker's dedicated connection, one
// GetNextJob call at a time.
func (w *Worker) manualWait(ctx context.Context, timeout time.Duration) (WaitResult, error) {
	sem := w.manualWaiting()
	select {
	case sem <- struct{}{}:
	case <-ctx.Done():
		return WaitResult{}, ctx.Err()
	}
	defer func() { <-sem }()
	return w.backend.WaitForJob(ctx, timeout)
}

// manualWaiting returns the semaphore of blocking GetNextJob calls.
func (w *Worker) manualWaiting() chan struct{} {
	w.manual.mu.Lock()
	defer w.manual.mu.Unlock()
	if w.manual.waiting == nil {
		w.manual.waiting = make(chan struct{}, 1)
	}
	return w.manual.waiting
}

// manualFetch moves the next job to active, locked with token, and records
// why none was fetched.
func (w *Worker) manualFetch(ctx context.Context, token string) (*Job, *FetchResult, error) {
	if until := w.limitUntil.Load(); until > nowMillis() {
		return nil, &FetchResult{RateLimitDelay: time.Until(time.UnixMilli(until))}, nil
	}
	res, err := w.backend.MoveToActive(ctx, w.fetchOptions(token))
	if err != nil {
		return nil, nil, w.manualErr(ctx, err)
	}
	if res == nil {
		res = &FetchResult{}
	}
	return w.manualNext(ctx, res, token), res, nil
}

// manualNext turns a fetch made for a job finished or fetched by hand into
// the next job, or nil. As in Node.js, the job of a job scheduler first adds
// the job of the scheduler's next iteration, and EventActive is emitted.
func (w *Worker) manualNext(ctx context.Context, res *FetchResult, token string) *Job {
	if res == nil {
		return nil
	}
	if res.Job == nil {
		w.noteEmptyFetch(res)
		return nil
	}
	w.drained.Store(false)
	job := w.newActiveJob(res.Job, token)
	if job.RepeatJobKey != "" {
		ok, failure := w.scheduleNextIteration(ctx, job)
		if !ok {
			// Left active, for the stalled check to retry the scheduling.
			return nil
		}
		if failure != nil {
			// The scheduler can't be advanced here: fail the job, unprocessed,
			// as the worker's loop does.
			if _, err := w.moveToFailed(ctx, job, failure, false); err != nil {
				w.emitError(err)
			}
			return nil
		}
	}
	w.emit(Event{Type: EventActive, Job: job})
	return job
}

// manualErr reports ErrWorkerClosed for an error caused by Close.
func (w *Worker) manualErr(ctx context.Context, err error) error {
	if w.stopping() && ctx.Err() == nil {
		return ErrWorkerClosed
	}
	return err
}

// nameManualConnection names the worker's dedicated connection, for worker
// discovery, as Run does.
func (w *Worker) nameManualConnection(ctx context.Context) {
	w.manual.nameOnce.Do(func() {
		name := w.backend.ClientName(clientNameSuffix(w.opts.Name))
		if err := w.backend.SetName(ctx, name); err != nil {
			w.emitError(fmt.Errorf("bullmq: unable to set client name: %w", err))
		}
	})
}

// StartStalledCheck starts the stalled check of a worker without a
// processor, as Node's startStalledCheckTimer does: right away and then
// every StalledInterval until the worker is closed, it moves the active jobs
// whose lock expired back to wait, or fails those that stalled more than
// MaxStalledCount times, and reports them with EventStalled. Calling it
// again does nothing, nor does it when SkipStalledCheck is set. A worker
// with a processor checks for stalled jobs while it runs, so it returns a
// [ConfigError] there.
func (w *Worker) StartStalledCheck() error {
	if w.proc != nil {
		return configError("Run checks for stalled jobs; StartStalledCheck is for workers without a processor")
	}
	w.manual.mu.Lock()
	defer w.manual.mu.Unlock()
	if w.stopping() {
		return ErrWorkerClosed
	}
	if w.opts.SkipStalledCheck || w.manual.started {
		return nil
	}
	w.manual.started = true
	ctx, cancel := context.WithCancel(context.Background())
	w.manual.wg.Add(1)
	go func() {
		defer w.manual.wg.Done()
		defer cancel()
		go func() {
			select {
			case <-w.stop:
				cancel()
			case <-ctx.Done():
			}
		}()
		w.nameManualConnection(ctx)
		w.stalledCheckLoop(ctx)
	}()
	return nil
}

// stopManual waits for the stalled check started by StartStalledCheck. Close
// calls it once the worker is stopping.
func (w *Worker) stopManual() {
	w.manual.mu.Lock()
	w.manual.mu.Unlock() //nolint:staticcheck // a barrier: StartStalledCheck sees the worker stopping from now on
	w.manual.wg.Wait()
}
