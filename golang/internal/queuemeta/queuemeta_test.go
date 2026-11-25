package queuemeta

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

var errTransient = errors.New("transient")

func isTransient(err error) bool { return errors.Is(err, errTransient) }

func TestWriteOnce(t *testing.T) {
	w := New(map[string]any{"version": "bullmq:1"})
	var calls atomic.Int32
	write := func(_ context.Context, values map[string]any) error {
		calls.Add(1)
		if values["version"] != "bullmq:1" {
			t.Errorf("values = %v", values)
		}
		time.Sleep(10 * time.Millisecond)
		return nil
	}
	var wg sync.WaitGroup
	for range 20 {
		wg.Go(func() { w.Write(context.Background(), write, isTransient) })
	}
	wg.Wait()
	if n := calls.Load(); n != 1 {
		t.Fatalf("write called %d times, want once", n)
	}
}

func TestWriteRetriesOnlyTransientFailures(t *testing.T) {
	w := New(map[string]any{"version": "bullmq:1"})
	var calls int
	fail := func(err error) func(context.Context, map[string]any) error {
		return func(context.Context, map[string]any) error { calls++; return err }
	}
	w.Write(context.Background(), fail(errTransient), isTransient)
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	w.Write(cancelled, fail(context.Canceled), isTransient)
	w.Write(context.Background(), fail(errors.New("NOPERM")), isTransient)
	w.Write(context.Background(), fail(nil), isTransient)
	if calls != 3 {
		t.Fatalf("write called %d times, want 3: retried after the transient and cancelled failures only", calls)
	}
}

func TestStopPreventsLaterWritesAndWaitsForOneInProgress(t *testing.T) {
	w := New(map[string]any{"version": "bullmq:1"})
	started, release := make(chan struct{}), make(chan struct{})
	var finished atomic.Bool
	go w.Write(context.Background(), func(context.Context, map[string]any) error {
		close(started)
		<-release
		finished.Store(true)
		return errTransient
	}, isTransient)
	<-started
	stopped := make(chan struct{})
	go func() { w.Stop(); close(stopped) }()
	select {
	case <-stopped:
		t.Fatal("Stop returned while a write was in progress")
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	<-stopped
	if !finished.Load() {
		t.Fatal("Stop returned before the write finished")
	}
	w.Write(context.Background(), func(context.Context, map[string]any) error {
		t.Error("write called after Stop")
		return nil
	}, isTransient)
}

func TestNilWriter(t *testing.T) {
	w := New(nil)
	if w != nil {
		t.Fatal("New(nil) is not nil")
	}
	w.Write(context.Background(), func(context.Context, map[string]any) error {
		t.Error("a nil Writer wrote")
		return nil
	}, isTransient)
	w.Stop()
}
