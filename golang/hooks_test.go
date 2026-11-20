package bullmq_test

import (
	"context"
	"sync"
	"sync/atomic"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// backendHooks counts the backend calls a worker makes and lets a test
// intercept some of them. Wrap a factory with it to observe every backend the
// factory builds.
type backendHooks struct {
	moveToActive atomic.Int64
	// fetchNext counts finishing calls (complete, fail, delay) that asked for
	// the next job.
	fetchNext atomic.Int64
	waits     atomic.Int64
	// failures counts MoveToFailed, RetryJob and MoveToDelayed calls.
	failures atomic.Int64

	mu     sync.Mutex
	tokens map[string]struct{}

	// Optional interceptors; they receive the wrapped backend.
	onMoveToCompleted func(ctx context.Context, b bullmq.Backend, jobID string, rv []byte, opts bullmq.FinishOptions) (*bullmq.FinishResult, error)
	onMoveToDelayed   func(ctx context.Context, b bullmq.Backend, jobID, token string, delay time.Duration, opts bullmq.MoveToDelayedOptions) (*bullmq.FetchResult, error)
}

func (h *backendHooks) wrap(f bullmq.BackendFactory) bullmq.BackendFactory {
	return func(name string, opts bullmq.BackendOptions) (bullmq.Backend, error) {
		b, err := f(name, opts)
		if err != nil {
			return nil, err
		}
		return &hookedBackend{Backend: b, hooks: h}, nil
	}
}

func (h *backendHooks) fetches() int64 { return h.moveToActive.Load() + h.fetchNext.Load() }

// finishTokens returns how many distinct lock tokens finished jobs.
func (h *backendHooks) finishTokens() int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.tokens)
}

func (h *backendHooks) noteFinish(token string, fetchNext bool) {
	if fetchNext {
		h.fetchNext.Add(1)
	}
	h.mu.Lock()
	if h.tokens == nil {
		h.tokens = map[string]struct{}{}
	}
	h.tokens[token] = struct{}{}
	h.mu.Unlock()
}

type hookedBackend struct {
	bullmq.Backend
	hooks *backendHooks
}

func (b *hookedBackend) MoveToActive(ctx context.Context, opts bullmq.MoveToActiveOptions) (*bullmq.FetchResult, error) {
	b.hooks.moveToActive.Add(1)
	return b.Backend.MoveToActive(ctx, opts)
}

func (b *hookedBackend) MoveToCompleted(ctx context.Context, jobID string, rv []byte, opts bullmq.FinishOptions) (*bullmq.FinishResult, error) {
	b.hooks.noteFinish(opts.Token, opts.FetchNext)
	if f := b.hooks.onMoveToCompleted; f != nil {
		return f(ctx, b.Backend, jobID, rv, opts)
	}
	return b.Backend.MoveToCompleted(ctx, jobID, rv, opts)
}

func (b *hookedBackend) MoveToFailed(ctx context.Context, jobID string, failure bullmq.FailureInfo, opts bullmq.FinishOptions) (*bullmq.FinishResult, error) {
	b.hooks.failures.Add(1)
	b.hooks.noteFinish(opts.Token, opts.FetchNext)
	return b.Backend.MoveToFailed(ctx, jobID, failure, opts)
}

func (b *hookedBackend) MoveToDelayed(ctx context.Context, jobID, token string, delay time.Duration, opts bullmq.MoveToDelayedOptions) (*bullmq.FetchResult, error) {
	b.hooks.failures.Add(1)
	b.hooks.noteFinish(token, opts.FetchNext)
	if f := b.hooks.onMoveToDelayed; f != nil {
		return f(ctx, b.Backend, jobID, token, delay, opts)
	}
	return b.Backend.MoveToDelayed(ctx, jobID, token, delay, opts)
}

func (b *hookedBackend) RetryJob(ctx context.Context, jobID, token string, lifo bool, failure *bullmq.FailureInfo) error {
	b.hooks.failures.Add(1)
	return b.Backend.RetryJob(ctx, jobID, token, lifo, failure)
}

func (b *hookedBackend) WaitForJob(ctx context.Context, timeout time.Duration) (bullmq.WaitResult, error) {
	b.hooks.waits.Add(1)
	return b.Backend.WaitForJob(ctx, timeout)
}

// eventLog collects the events of a worker.
type eventLog struct {
	mu     sync.Mutex
	events []bullmq.Event
}

// collect consumes w.Events() until the worker closes it.
func (l *eventLog) collect(w *bullmq.Worker) {
	go func() {
		for ev := range w.Events() {
			l.add(ev)
		}
	}()
}

func (l *eventLog) add(ev bullmq.Event) {
	l.mu.Lock()
	l.events = append(l.events, ev)
	l.mu.Unlock()
}

func (l *eventLog) count(typ bullmq.EventType) int {
	l.mu.Lock()
	defer l.mu.Unlock()
	n := 0
	for _, ev := range l.events {
		if ev.Type == typ {
			n++
		}
	}
	return n
}

// jobsWith returns the ids of the jobs of the events of type typ.
func (l *eventLog) jobsWith(typ bullmq.EventType) []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	var ids []string
	for _, ev := range l.events {
		if ev.Type == typ && ev.Job != nil {
			ids = append(ids, ev.Job.ID)
		}
	}
	return ids
}
