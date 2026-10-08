package bullmq

import (
	"context"
	"sync"
	"time"
)

// QueueEvent is a single entry of the queue's event stream.
type QueueEvent struct {
	// ID is the backend specific event id (a Redis stream entry id).
	ID string
	// Event is the event name, for example `added`, `active`, `completed`,
	// `failed`, `progress`, `delayed`, `waiting`, `stalled`, `removed`,
	// `paused`, `resumed` or `drained`.
	Event string
	// JobID is the job the event refers to, when applicable.
	JobID string
	// Data holds every field of the stream entry, including `event` and `jobId`.
	Data map[string]string
}

// ReturnValue returns the serialized processor result of a `completed` event.
func (e QueueEvent) ReturnValue() string { return e.Data["returnvalue"] }

// FailedReason returns the error message of a `failed` event.
func (e QueueEvent) FailedReason() string { return e.Data["failedReason"] }

// QueueEvents streams the global events emitted by a queue, allowing a process
// that does not run the worker to observe job progress.
type QueueEvents struct {
	// backend owns a connection dedicated to the long poll of ReadEvents so it
	// can never starve other operations.
	backend Backend
	opts    QueueEventsOptions
	events  chan QueueEvent
	errs    chan error
	stop    chan struct{}
	done    chan struct{}
	runOnce sync.Once
	stopped sync.Once
}

// NewQueueEvents creates an event listener for the given queue.
func NewQueueEvents(queueName string, opts *QueueEventsOptions) (*QueueEvents, error) {
	if opts == nil {
		opts = &QueueEventsOptions{}
	}
	o := *opts
	if o.LastEventID == "" {
		o.LastEventID = "$"
	}
	if o.BlockingTimeout <= 0 {
		o.BlockingTimeout = 5 * time.Second
	}
	if o.BufferSize <= 0 {
		o.BufferSize = 128
	}
	backend, err := resolveBackend(o.Backend, o.Redis, queueName, BackendOptions{
		Prefix:                 o.Prefix,
		WithBlockingConnection: true,
		ClientNameSuffix:       ":qe",
		BlockTimeout:           o.BlockingTimeout,
	})
	if err != nil {
		return nil, err
	}
	return &QueueEvents{
		backend: backend,
		opts:    o,
		events:  make(chan QueueEvent, o.BufferSize),
		errs:    make(chan error, 8),
		stop:    make(chan struct{}),
		done:    make(chan struct{}),
	}, nil
}

// Events returns the channel on which stream entries are delivered. It is
// closed when the listener stops.
func (qe *QueueEvents) Events() <-chan QueueEvent { return qe.events }

// Errors returns the channel carrying non-fatal read errors. It is closed
// when the listener stops, after the last error has been sent.
func (qe *QueueEvents) Errors() <-chan error { return qe.errs }

// Run starts consuming the event stream and blocks until ctx is cancelled or
// Close is called.
func (qe *QueueEvents) Run(ctx context.Context) error {
	var err error
	started := false
	qe.runOnce.Do(func() {
		started = true
		err = qe.run(ctx)
	})
	if !started {
		return ErrQueueEventsClosed
	}
	return err
}

func (qe *QueueEvents) run(ctx context.Context) error {
	defer close(qe.done)
	// Only this goroutine sends on events and errs, so closing them here, once
	// the loop has returned, cannot race with a send.
	defer close(qe.errs)
	defer close(qe.events)

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() {
		select {
		case <-qe.stop:
			cancel()
		case <-ctx.Done():
		}
	}()

	lastID := qe.opts.LastEventID
	if lastID == "$" {
		id, err := qe.backend.LastEventID(ctx)
		if err != nil {
			return err
		}
		lastID = id
	}

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		events, err := qe.backend.ReadEvents(ctx, lastID, qe.opts.BlockingTimeout)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			select {
			case qe.errs <- err:
			default:
			}
			if !sleepCtx(ctx, time.Second) {
				return ctx.Err()
			}
			continue
		}

		for _, ev := range events {
			lastID = ev.ID
			select {
			case qe.events <- ev:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}
}

// Close stops the listener and releases the connection when it owns it.
func (qe *QueueEvents) Close() error {
	qe.stopped.Do(func() { close(qe.stop) })

	// Claim the runOnce slot in case Run was never called. If we win the
	// race, Run has not started (and never will), so we must close done
	// and the channels ourselves. If Run already claimed it, it owns those
	// closes via its deferred cleanup and we just wait for it below.
	closedHere := false
	qe.runOnce.Do(func() {
		closedHere = true
		close(qe.done)
		close(qe.events)
		close(qe.errs)
	})

	if !closedHere {
		select {
		case <-qe.done:
		case <-time.After(qe.opts.BlockingTimeout + time.Second):
		}
	}
	return qe.backend.Close()
}
