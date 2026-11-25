// Package queuemeta writes the metadata of a queue (bullmq.BackendOptions.
// QueueMeta) once, before the first command of its backend, for the
// backends to share.
package queuemeta

import (
	"context"
	"sync"
	"sync/atomic"
)

// Writer writes a queue's metadata once. A nil Writer writes nothing.
type Writer struct {
	values map[string]any
	mu     sync.Mutex
	done   atomic.Bool
}

// New returns a Writer for values, or nil when there are none.
func New(values map[string]any) *Writer {
	if len(values) == 0 {
		return nil
	}
	return &Writer{values: values}
}

// Write calls write with the values, unless they were written already or
// Stop was called, and waits for a write in progress in another goroutine.
// A failed write is dropped, as Node drops it, so a role that may not write
// does not pay for it on every command. It is left to the next call when it
// failed because ctx was done or with an error transient reports.
func (w *Writer) Write(ctx context.Context, write func(ctx context.Context, values map[string]any) error, transient func(error) bool) {
	if w == nil || w.done.Load() {
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.done.Load() {
		return
	}
	if err := write(ctx, w.values); err != nil && (ctx.Err() != nil || transient(err)) {
		return
	}
	w.done.Store(true)
}

// Stop makes every later Write a no-op, once a write in progress is done, so
// the metadata cannot be written after the queue is obliterated or closed.
func (w *Writer) Stop() {
	if w == nil {
		return
	}
	w.mu.Lock()
	w.done.Store(true)
	w.mu.Unlock()
}
