package bullmq

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

// slowWaitBackend blocks WaitForJob until its context is done and then
// takes a moment to return, as a Redis wait does while it releases the
// connection that Close interrupted. Close records whether a wait was
// still running: closing the backend then fails on that connection.
type slowWaitBackend struct {
	stubBackend
	started     chan struct{}
	waiting     atomic.Int32
	closedEarly atomic.Bool
}

func (b *slowWaitBackend) ClientName(suffix string) string { return "stub" + suffix }

func (b *slowWaitBackend) SetName(context.Context, string) error { return nil }

func (b *slowWaitBackend) MoveToActive(context.Context, MoveToActiveOptions) (*FetchResult, error) {
	return &FetchResult{}, nil
}

func (b *slowWaitBackend) WaitForJob(ctx context.Context, _ time.Duration) (WaitResult, error) {
	b.waiting.Add(1)
	defer b.waiting.Add(-1)
	b.started <- struct{}{}
	<-ctx.Done()
	time.Sleep(50 * time.Millisecond)
	return WaitResult{}, ctx.Err()
}

func (b *slowWaitBackend) Close() error {
	if b.waiting.Load() > 0 {
		b.closedEarly.Store(true)
	}
	return nil
}

// Close interrupts a blocking GetNextJob and waits for its wait to return
// before it closes the backend.
func TestCloseWaitsForABlockingGetNextJob(t *testing.T) {
	b := &slowWaitBackend{started: make(chan struct{}, 1)}
	w, err := NewWorker("manual-close", nil, &WorkerOptions{
		Backend:    func(string, BackendOptions) (Backend, error) { return b, nil },
		DrainDelay: 10 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewWorker: %v", err)
	}
	got := make(chan error, 1)
	go func() {
		_, err := w.GetNextJob(context.Background(), "token", true)
		got <- err
	}()
	<-b.started
	if err := w.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if b.closedEarly.Load() {
		t.Error("Close closed the backend while GetNextJob was still waiting on it")
	}
	select {
	case err := <-got:
		if !errors.Is(err, ErrWorkerClosed) {
			t.Errorf("GetNextJob interrupted by Close = %v, want ErrWorkerClosed", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Close did not interrupt GetNextJob")
	}
}
