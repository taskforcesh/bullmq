package bullmq

import "sync"

// slotState counts the processing slots in use against the concurrency,
// which SetConcurrency may change while the worker runs. A slot is in use
// from the fetch of its first job until its last chained job finishes.
type slotState struct {
	mu    sync.Mutex
	limit int
	busy  int
}

// acquireSlot takes a free slot, if there is one.
func (w *Worker) acquireSlot() bool {
	w.slots.mu.Lock()
	defer w.slots.mu.Unlock()
	if w.slots.busy >= w.slots.limit {
		return false
	}
	w.slots.busy++
	return true
}

// releaseSlot frees a slot taken with acquireSlot.
func (w *Worker) releaseSlot() {
	w.slots.mu.Lock()
	w.slots.busy--
	w.slots.mu.Unlock()
}

// hasFreeSlot reports whether acquireSlot would take a slot.
func (w *Worker) hasFreeSlot() bool {
	w.slots.mu.Lock()
	defer w.slots.mu.Unlock()
	return w.slots.busy < w.slots.limit
}

// withinConcurrency reports whether the slots in use, the caller's
// included, fit the concurrency, as Node's numTotal() <= concurrency.
func (w *Worker) withinConcurrency() bool {
	w.slots.mu.Lock()
	defer w.slots.mu.Unlock()
	return w.slots.busy <= w.slots.limit
}

// SetConcurrency changes how many jobs the worker processes in parallel
// while it runs, as setting Node's worker.concurrency does. Raising it
// fetches jobs for the new slots right away. Lowering it lets the jobs in
// flight finish: a slot finishing a job fetches no next job while more
// slots than n are in use. n must be at least 1.
func (w *Worker) SetConcurrency(n int) error {
	if n < 1 {
		return configError("concurrency must be at least 1, got %d", n)
	}
	w.slots.mu.Lock()
	w.slots.limit = n
	w.slots.mu.Unlock()
	signal(w.wake)
	return nil
}

// Concurrency returns how many jobs the worker processes in parallel:
// WorkerOptions.Concurrency, or the value of the last SetConcurrency.
func (w *Worker) Concurrency() int {
	w.slots.mu.Lock()
	defer w.slots.mu.Unlock()
	return w.slots.limit
}
