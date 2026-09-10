package bullmq

import (
	"context"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// QueueEvent is a single entry of the queue's Redis event stream.
type QueueEvent struct {
	// ID is the Redis stream entry id.
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
	c       *client
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
	c, err := newClient(queueName, o.Prefix, o.Redis)
	if err != nil {
		return nil, err
	}
	return &QueueEvents{
		c:      c,
		opts:   o,
		events: make(chan QueueEvent, o.BufferSize),
		errs:   make(chan error, 8),
		stop:   make(chan struct{}),
		done:   make(chan struct{}),
	}, nil
}

// Events returns the channel on which stream entries are delivered. It is
// closed when the listener stops.
func (qe *QueueEvents) Events() <-chan QueueEvent { return qe.events }

// Errors returns the channel carrying non-fatal read errors.
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
		return ErrWorkerClosed
	}
	return err
}

func (qe *QueueEvents) run(ctx context.Context) error {
	defer close(qe.done)
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

	key := qe.c.keys.Events()
	lastID := qe.opts.LastEventID

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		streams, err := qe.c.rdb.XRead(ctx, &redis.XReadArgs{
			Streams: []string{key, lastID},
			Block:   qe.opts.BlockingTimeout,
		}).Result()
		if err != nil {
			if err == redis.Nil {
				continue
			}
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

		for _, stream := range streams {
			for _, msg := range stream.Messages {
				lastID = msg.ID
				ev := QueueEvent{ID: msg.ID, Data: make(map[string]string, len(msg.Values))}
				for k, v := range msg.Values {
					s, _ := asString(v)
					ev.Data[k] = s
				}
				ev.Event = ev.Data["event"]
				ev.JobID = ev.Data["jobId"]
				select {
				case qe.events <- ev:
				case <-ctx.Done():
					return ctx.Err()
				}
			}
		}
	}
}

// Close stops the listener and releases the connection when it owns it.
func (qe *QueueEvents) Close() error {
	qe.stopped.Do(func() { close(qe.stop) })
	select {
	case <-qe.done:
	case <-time.After(qe.opts.BlockingTimeout + time.Second):
	}
	return qe.c.close()
}
