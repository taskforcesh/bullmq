package postgresbackend

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// defaultLockMillis is the lock duration used when none is given, as in the
// other ports.
const defaultLockMillis = 30_000

// fetchArgs are the settings of a fetch shared by move_to_active and the
// commands that fetch the next job.
type fetchArgs struct {
	token           string
	lockMs          int64
	workerName      any
	limiterMax      any
	limiterDuration any
}

func newFetchArgs(token string, lock time.Duration, workerName string, limiter *bullmq.RateLimiter) fetchArgs {
	a := fetchArgs{token: lockToken(token), lockMs: lock.Milliseconds()}
	if a.lockMs <= 0 {
		a.lockMs = defaultLockMillis
	}
	if workerName != "" {
		a.workerName = workerName
	}
	if limiter != nil {
		a.limiterMax = clampInt32(limiter.Max)
		a.limiterDuration = limiter.Duration.Milliseconds()
	}
	return a
}

// lockToken maps an empty token to "0", the token the shared commands treat
// as "skip the lock check", as Node's default token does.
func lockToken(token string) string {
	if token == "" {
		return "0"
	}
	return token
}

// MoveToActive moves the next job to active and locks it. When none can be
// fetched, the result reports the rate limit or the next delayed job.
func (b *Backend) MoveToActive(ctx context.Context, opts bullmq.MoveToActiveOptions) (*bullmq.FetchResult, error) {
	a := newFetchArgs(opts.Token, opts.LockDuration, opts.WorkerName, opts.Limiter)
	now := nowMillis()
	jobs, err := b.queryJobs(ctx, "move_to_active",
		b.name, a.token, a.lockMs, now, a.workerName, a.limiterMax, a.limiterDuration)
	if err != nil {
		return nil, err
	}
	return b.fetchResult(ctx, jobs, a.limiterMax, now)
}

// fetchResult shapes the rows of a fetch. When no job was fetched it asks
// next_signal why: the rate limit if the queue is limited, otherwise the
// next delayed job.
func (b *Backend) fetchResult(ctx context.Context, jobs []*bullmq.JobRecord, limiterMax any, now int64) (*bullmq.FetchResult, error) {
	if len(jobs) > 0 {
		return &bullmq.FetchResult{Job: jobs[0]}, nil
	}
	var ttl, next *int64
	if err := b.queryRow(ctx, "next_signal", []any{b.name, limiterMax, now}, &ttl, &next); err != nil {
		return nil, err
	}
	res := &bullmq.FetchResult{}
	switch {
	case ttl != nil && *ttl > 0:
		res.RateLimitDelay = time.Duration(*ttl) * time.Millisecond
	case next != nil && *next > 0:
		res.NextDelayedAt = *next
	}
	return res, nil
}

// MoveToCompleted moves an active job to completed and, when requested,
// fetches the next job in the same transaction.
func (b *Backend) MoveToCompleted(ctx context.Context, jobID string, returnValue []byte, opts bullmq.FinishOptions) (*bullmq.FinishResult, error) {
	value := string(returnValue)
	if value == "" {
		value = "null"
	}
	return b.moveToFinished(ctx, "completed", jobID, []any{value}, opts)
}

// MoveToFailed moves an active job to failed and, when requested, fetches
// the next job in the same transaction.
func (b *Backend) MoveToFailed(ctx context.Context, jobID string, failure bullmq.FailureInfo, opts bullmq.FinishOptions) (*bullmq.FinishResult, error) {
	trace, err := stacktraceArg(failure.Stacktrace)
	if err != nil {
		return nil, err
	}
	return b.moveToFinished(ctx, "failed", jobID, []any{failure.Reason, trace}, opts)
}

// moveToFinished runs move_to_<target>, or move_to_<target>_fetch with
// fetch-next. values are the target specific parameters that follow the
// token: the return value, or the failed reason and stack trace.
func (b *Backend) moveToFinished(ctx context.Context, target, jobID string, values []any, opts bullmq.FinishOptions) (*bullmq.FinishResult, error) {
	removeAll, keepAge, keepCount := keepArgs(opts.KeepJobs)
	finishedOn := nowMillis()

	args := make([]any, 0, 14)
	args = append(args, b.name, jobID, lockToken(opts.Token))
	args = append(args, values...)
	args = append(args, finishedOn, removeAll, keepAge, keepCount)

	res := &bullmq.FinishResult{FinishedOn: finishedOn}
	if opts.FetchNext {
		a := newFetchArgs(opts.Token, opts.LockDuration, opts.WorkerName, opts.Limiter)
		now := nowMillis()
		args = append(args, a.lockMs, now, a.workerName, a.limiterMax, a.limiterDuration)
		jobs, err := b.queryJobs(ctx, "move_to_"+target+"_fetch", args...)
		if err != nil {
			return nil, err
		}
		b.collectMetrics(ctx, target, finishedOn, opts.Metrics)
		// The job has finished: a failure to read the hints of an empty fetch
		// must not be reported as a failed finish, which the worker would
		// retry and find the job no longer active. Report no hints instead.
		if res.Next, err = b.fetchResult(ctx, jobs, a.limiterMax, now); err != nil {
			res.Next = &bullmq.FetchResult{}
		}
		return res, nil
	}
	if err := b.exec(ctx, "move_to_"+target, args...); err != nil {
		return nil, err
	}
	b.collectMetrics(ctx, target, finishedOn, opts.Metrics)
	return res, nil
}

// collectMetrics records a finished job in the per-minute metrics. As in the
// Node.js backend it is a separate, best-effort statement: the job has
// already moved, so a failure here must not be reported as a failed finish.
func (b *Backend) collectMetrics(ctx context.Context, kind string, finishedOn int64, m *bullmq.MetricsOptions) {
	if m == nil || m.MaxDataPoints <= 0 {
		return
	}
	_ = b.exec(ctx, "collect_metrics", b.name, kind, clampInt32(m.MaxDataPoints), finishedOn)
}

// keepArgs turns a removal policy into the retention parameters of the
// finishing commands, as Node's normalizeKeep does.
func keepArgs(k *bullmq.RemoveOnFinish) (removeAll bool, keepAge, keepCount any) {
	if k == nil {
		return false, nil, nil
	}
	// RemoveAll, and a count of 0, remove the job straight away, as on Redis.
	// The keep-count retention of the shared SQL would instead trim the whole
	// finished set down to 0 jobs, so ask for the removal of this job only.
	if k.IsRemoveAll() || (k.Count != nil && *k.Count == 0) {
		return true, nil, nil
	}
	if k.Age != nil {
		keepAge = *k.Age
	}
	if k.Count != nil {
		keepCount = clampInt32(*k.Count)
	}
	return false, keepAge, keepCount
}

// stacktraceArg encodes the stack trace parameter: a JSON array, or NULL to
// keep the stored one.
func stacktraceArg(trace []string) (any, error) {
	if trace == nil {
		return nil, nil
	}
	raw, err := json.Marshal(trace)
	if err != nil {
		return nil, err
	}
	return string(raw), nil
}

// failureArgs returns the failed reason and stack trace parameters, NULL when
// there is no failure to record.
func failureArgs(f *bullmq.FailureInfo) (reason, trace any, err error) {
	if f == nil {
		return nil, nil, nil
	}
	trace, err = stacktraceArg(f.Stacktrace)
	return f.Reason, trace, err
}

// MoveToDelayed reschedules an active job and, when requested, fetches the
// next job with the same token.
func (b *Backend) MoveToDelayed(ctx context.Context, jobID, token string, delay time.Duration, opts bullmq.MoveToDelayedOptions) (*bullmq.FetchResult, error) {
	ms := max(delay.Milliseconds(), 0)
	now := nowMillis()
	processAt := now + ms
	if ms > math.MaxInt64-now {
		processAt = math.MaxInt64
	}
	reason, trace, err := failureArgs(opts.Failure)
	if err != nil {
		return nil, err
	}
	if err := b.exec(ctx, "move_to_delayed",
		b.name, jobID, lockToken(token), processAt, ms, opts.SkipAttempt, reason, trace); err != nil {
		return nil, err
	}
	if !opts.FetchNext || lockToken(token) == "0" {
		return nil, nil
	}
	next, err := b.MoveToActive(ctx, bullmq.MoveToActiveOptions{
		Token:        token,
		LockDuration: opts.LockDuration,
		WorkerName:   opts.WorkerName,
		Limiter:      opts.Limiter,
	})
	if err != nil {
		// The job is delayed already, so the call succeeded; an empty result
		// tells the worker to fetch again.
		return &bullmq.FetchResult{}, nil
	}
	return next, nil
}

// MoveJobFromActiveToWait puts an active job back in the wait list without
// counting an attempt and returns the remaining rate-limit time.
//
// The shared command leaves a job locked by another token alone without
// saying so; the lock is checked first so that, as on Redis, a missing or
// foreign lock is reported.
func (b *Backend) MoveJobFromActiveToWait(ctx context.Context, jobID, token string) (time.Duration, error) {
	token = lockToken(token)
	if token != "0" {
		held, found, err := b.lockOf(ctx, jobID)
		switch {
		case err != nil:
			return 0, err
		case !found:
			return 0, codeError("moveJobFromActiveToWait", bullmq.ErrCodeJobNotExist)
		case held == nil:
			return 0, codeError("moveJobFromActiveToWait", bullmq.ErrCodeJobLockNotExist)
		case *held != token:
			return 0, codeError("moveJobFromActiveToWait", bullmq.ErrCodeJobLockMismatch)
		}
	}
	var pttl int64
	if err := b.queryRow(ctx, "move_active_to_wait",
		[]any{b.name, jobID, token, nowMillis()}, &pttl); err != nil {
		return 0, err
	}
	if pttl < 0 {
		return 0, codeError("moveJobFromActiveToWait", pttl)
	}
	return time.Duration(pttl) * time.Millisecond, nil
}

// lockOf returns the lock token held on a job, nil when it is not locked.
// found is false when the job does not exist.
func (b *Backend) lockOf(ctx context.Context, jobID string) (token *string, found bool, err error) {
	err = b.run(ctx, "get_job_data", func(ctx context.Context, sql string) error {
		rows, err := b.pool.Query(ctx, sql, b.name, jobID)
		if err != nil {
			return err
		}
		defer rows.Close()
		fields := rows.FieldDescriptions()
		dest := make([]any, len(fields))
		for i, f := range fields {
			if f.Name == "lock_token" {
				dest[i] = &token
			}
		}
		if rows.Next() {
			found = true
			if err := rows.Scan(dest...); err != nil {
				return err
			}
		}
		return rows.Err()
	})
	return token, found, err
}

// MoveToWaitingChildren parks an active parent job until its children
// finish. When child is given, the job is only parked if that child is one
// of its pending dependencies, as on Redis.
func (b *Backend) MoveToWaitingChildren(ctx context.Context, jobID, token string, child *bullmq.ParentKeys) (bool, error) {
	if child != nil && child.ID != "" {
		pending, err := b.isPendingChild(ctx, jobID, child)
		if err != nil || !pending {
			return false, err
		}
	}
	var code int64
	if err := b.queryRow(ctx, "move_to_waiting_children",
		[]any{b.name, jobID, lockToken(token)}, &code); err != nil {
		return false, err
	}
	if code < 0 {
		return false, codeError("moveToWaitingChildren", code)
	}
	return code == 1, nil
}

// isPendingChild reports whether child is an unfinished child of the job.
func (b *Backend) isPendingChild(ctx context.Context, jobID string, child *bullmq.ParentKeys) (bool, error) {
	queue := child.QueueKey
	if i := strings.LastIndex(queue, ":"); i >= 0 {
		queue = queue[i+1:]
	}
	jobs, err := b.queryJobs(ctx, "get_job_data", queue, child.ID)
	if err != nil || len(jobs) == 0 {
		return false, err
	}
	rec := jobs[0]
	return rec.Parent != nil && rec.Parent.ID == jobID && rec.Parent.QueueKey == b.name && rec.FinishedOn == 0, nil
}

// RetryJob puts an active job straight back into the wait list.
func (b *Backend) RetryJob(ctx context.Context, jobID, token string, lifo bool, failure *bullmq.FailureInfo) error {
	reason, trace, err := failureArgs(failure)
	if err != nil {
		return err
	}
	return b.exec(ctx, "retry_job", b.name, jobID, lockToken(token), lifo, reason, trace)
}

// MoveStalledJobsToWait recovers active jobs whose lock expired and returns
// their ids. The shared SQL uses a two-phase mark and sweep, so a job just
// fetched is never reclaimed.
func (b *Backend) MoveStalledJobsToWait(ctx context.Context, opts bullmq.StalledOptions) ([]string, error) {
	return b.queryStrings(ctx, "move_stalled_jobs_to_wait",
		b.name, clampInt32(int64(opts.MaxStalledCount)), nowMillis(), opts.Interval.Milliseconds())
}

// ExtendLock refreshes the lock held on an active job.
func (b *Backend) ExtendLock(ctx context.Context, jobID, token string, duration time.Duration) error {
	var n int64
	if err := b.queryRow(ctx, "extend_lock",
		[]any{b.name, jobID, token, duration.Milliseconds(), nowMillis()}, &n); err != nil {
		return err
	}
	if n != 1 {
		return bullmq.ErrJobLockNotExist
	}
	return nil
}

// ExtendLocks refreshes the locks of several active jobs in one statement
// and returns the ids whose lock could not be extended.
func (b *Backend) ExtendLocks(ctx context.Context, locks []bullmq.JobLock, duration time.Duration) ([]string, error) {
	if len(locks) == 0 {
		return nil, nil
	}
	ids := make([]string, len(locks))
	tokens := make([]string, len(locks))
	for i, l := range locks {
		ids[i] = l.JobID
		tokens[i] = l.Token
	}
	return b.queryStrings(ctx, "extend_locks", b.name, ids, tokens, duration.Milliseconds(), nowMillis())
}

// SetRateLimit makes the queue report a full rate-limit window for ttl.
func (b *Backend) SetRateLimit(ctx context.Context, ttl time.Duration) error {
	ms := ttl.Milliseconds()
	if ms < 1 {
		return configError("rate limit ttl must be at least 1ms, got %v", ttl)
	}
	return b.exec(ctx, "set_rate_limit", b.name, ms, nowMillis())
}

// WaitForJob blocks until a job may be claimed, a delayed job comes due, or
// timeout elapses.
//
// It subscribes to the jobs channel on the dedicated connection, then checks
// the queue: it returns at once when a job can be claimed, or with the due
// time of a delayed job it has not reported yet, as the delayed marker of
// Redis, which a blocked worker pops once, does. Otherwise it blocks until
// the next delayed job is due or a notification for this queue arrives, and
// then checks again, so a notification for work that cannot be claimed does
// not end the wait. Nothing is reported while the queue is paused or at its
// global concurrency limit. A cancelled ctx or Close ends the wait at once.
func (b *Backend) WaitForJob(ctx context.Context, timeout time.Duration) (bullmq.WaitResult, error) {
	if b.isClosed() {
		return bullmq.WaitResult{}, errClosed
	}
	if err := ctx.Err(); err != nil {
		return bullmq.WaitResult{}, err
	}
	deadline := time.Now().Add(max(timeout, time.Millisecond))
	if err := b.jobs.ensure(ctx); err != nil {
		return bullmq.WaitResult{}, err
	}
	for {
		// Taken before the check, so a notification sent after it is not
		// missed.
		signalled := b.jobs.signalled()
		p, err := b.probe(ctx)
		if err != nil {
			return bullmq.WaitResult{}, err
		}
		if p.claimable {
			return bullmq.WaitResult{Woken: true}, nil
		}
		wait := time.Until(deadline)
		dueFirst := false
		if p.nextDelayed != nil && !p.held {
			next := *p.nextDelayed
			dueIn := time.Until(time.UnixMilli(next))
			if dueIn <= 0 {
				return bullmq.WaitResult{Woken: true}, nil
			}
			if b.reportedDelay.Swap(next) != next {
				return bullmq.WaitResult{Woken: true, NextDelayedAt: next}, nil
			}
			if dueIn < wait {
				wait, dueFirst = dueIn, true
			}
		}
		if wait <= 0 {
			return bullmq.WaitResult{}, nil
		}

		t := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			t.Stop()
			return bullmq.WaitResult{}, ctx.Err()
		case <-b.closing:
			t.Stop()
			return bullmq.WaitResult{}, nil
		case <-t.C:
			return bullmq.WaitResult{Woken: dueFirst}, nil
		case <-signalled:
			t.Stop()
		}
	}
}

// queueProbe is what WaitForJob needs to know about the queue.
type queueProbe struct {
	// claimable is has_waiting_job: a job is waiting and the queue is
	// neither paused nor at its global concurrency limit.
	claimable bool
	// held is true while the queue is paused or at its global concurrency
	// limit, so no job can be claimed, delayed or not.
	held bool
	// nextDelayed is when the next delayed job is due (Unix milliseconds).
	nextDelayed *int64
}

// probe runs has_waiting_job, next_delay, is_maxed and the paused flag in
// one round trip.
func (b *Backend) probe(ctx context.Context) (queueProbe, error) {
	var p queueProbe
	var sqls [3]string
	for i, cmd := range []string{"next_delay", "is_maxed", "get_queue_meta_field"} {
		sql, err := command(cmd)
		if err != nil {
			return p, err
		}
		sqls[i] = sql
	}
	var maxed, paused bool
	err := b.run(ctx, "has_waiting_job", func(ctx context.Context, sql string) error {
		batch := &pgx.Batch{}
		batch.Queue(sql, b.name).QueryRow(func(row pgx.Row) error { return row.Scan(&p.claimable) })
		batch.Queue(sqls[0], b.name).QueryRow(func(row pgx.Row) error { return row.Scan(&p.nextDelayed) })
		batch.Queue(sqls[1], b.name).QueryRow(func(row pgx.Row) error { return row.Scan(&maxed) })
		batch.Queue(sqls[2], b.name, "paused").Query(func(rows pgx.Rows) error {
			defer rows.Close()
			for rows.Next() {
				var v *string
				if err := rows.Scan(&v); err != nil {
					return err
				}
				paused = v != nil && *v != "" && *v != "0"
			}
			return rows.Err()
		})
		return b.pool.SendBatch(ctx, batch).Close()
	})
	p.held = maxed || paused
	return p, err
}

func clampInt32(n int64) int64 {
	return max(min(n, math.MaxInt32), math.MinInt32)
}

// isNoRows reports whether err means a query returned no row.
func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }
