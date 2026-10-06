package bullmq

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestIsTransientRedisError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"eof", io.EOF, true},
		{"wrapped eof", fmt.Errorf("x: %w", io.ErrUnexpectedEOF), true},
		{"net op error", &net.OpError{Op: "dial", Err: errors.New("connection refused")}, true},
		{"timeout", context.DeadlineExceeded, true},
		{"redis nil", redis.Nil, false},
		{"script error", scriptError("moveToFinished", ErrCodeJobLockNotExist), false},
		{"plain", errors.New("boom"), false},
	}
	for _, tc := range cases {
		if got := isTransientRedisError(tc.err); got != tc.want {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func newTransitionTestWorker(t *testing.T) *Worker {
	t.Helper()
	w, err := NewWorker("transition", func(context.Context, *Job) (any, error) { return nil, nil }, nil)
	if err != nil {
		t.Fatalf("NewWorker: %v", err)
	}
	t.Cleanup(func() { _ = w.Close() })
	return w
}

func TestRetryTransitionRetriesTransientErrors(t *testing.T) {
	old := transitionRetryDelay
	transitionRetryDelay = time.Millisecond
	t.Cleanup(func() { transitionRetryDelay = old })

	w := newTransitionTestWorker(t)
	calls := 0
	err := w.retryTransition(context.Background(), func(context.Context) error {
		calls++
		if calls < 3 {
			return io.EOF
		}
		return nil
	})
	if err != nil || calls != 3 {
		t.Fatalf("err = %v, calls = %d; want nil, 3", err, calls)
	}
}

func TestRetryTransitionReturnsNonTransientImmediately(t *testing.T) {
	w := newTransitionTestWorker(t)
	want := scriptError("moveToFinished", ErrCodeJobLockMismatch)
	calls := 0
	err := w.retryTransition(context.Background(), func(context.Context) error {
		calls++
		return want
	})
	if !errors.Is(err, ErrJobLockMismatch) || calls != 1 {
		t.Fatalf("err = %v, calls = %d; want lock mismatch, 1", err, calls)
	}
}

func TestRetryTransitionKeepsRetryingDuringGracefulClose(t *testing.T) {
	old := transitionRetryDelay
	transitionRetryDelay = time.Millisecond
	t.Cleanup(func() { transitionRetryDelay = old })

	w := newTransitionTestWorker(t)
	w.stopOnce.Do(func() { close(w.stop) }) // graceful Close in progress; the Run context is still live
	calls := 0
	err := w.retryTransition(context.Background(), func(context.Context) error {
		calls++
		if calls < 3 {
			return io.EOF
		}
		return nil
	})
	if err != nil || calls != 3 {
		t.Fatalf("err = %v, calls = %d; want nil, 3", err, calls)
	}
}

func TestRetryTransitionStopsWhenRunContextIsCancelled(t *testing.T) {
	w := newTransitionTestWorker(t)
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	err := w.retryTransition(ctx, func(context.Context) error {
		calls++
		cancel() // forced stop while the transition is failing
		return io.EOF
	})
	if !errors.Is(err, io.EOF) || calls != 1 {
		t.Fatalf("err = %v, calls = %d; want EOF, 1", err, calls)
	}
}
