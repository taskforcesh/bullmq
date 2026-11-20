package redisbackend

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// A caller-supplied client whose read timeout is shorter than DrainDelay must
// not produce I/O errors while the queue is idle.
func TestWorkerSharedClientShortReadTimeout(t *testing.T) {
	requireRedis(t)
	rdb := redis.NewClient(&redis.Options{
		Addr:        redisAddr(),
		ReadTimeout: 300 * time.Millisecond,
	})
	defer rdb.Close()

	var errCount atomic.Int32
	w := newTestWorker(t, testQueueName(t), func(ctx context.Context, job *bullmq.Job) (any, error) {
		return nil, nil
	}, &bullmq.WorkerOptions{
		Backend:    testFactory(Options{Client: rdb}),
		DrainDelay: 1500 * time.Millisecond,
		OnError:    func(error) { errCount.Add(1) },
	})
	runWorker(t, w)

	time.Sleep(2500 * time.Millisecond)
	if n := errCount.Load(); n != 0 {
		t.Fatalf("expected no errors while idle, got %d", n)
	}
}

func TestWorkerStopsPromptlyWithLongDrainDelayAndSharedClient(t *testing.T) {
	requireRedis(t)
	rdb := redis.NewClient(&redis.Options{Addr: redisAddr()})
	defer rdb.Close()

	for _, stopByCancel := range []bool{false, true} {
		w := newTestWorker(t, testQueueName(t), func(context.Context, *bullmq.Job) (any, error) {
			return nil, nil
		}, &bullmq.WorkerOptions{
			Backend:          testFactory(Options{Client: rdb}),
			DrainDelay:       time.Hour,
			SkipLockRenewal:  true,
			SkipStalledCheck: true,
		})
		ctx, cancel := context.WithCancel(context.Background())
		runDone := make(chan error, 1)
		go func() { runDone <- w.Run(ctx) }()

		select {
		case <-time.After(5 * time.Second):
			cancel()
			t.Fatal("worker did not become idle")
		case event := <-w.Events():
			for event.Type != bullmq.EventDrained {
				select {
				case <-time.After(5 * time.Second):
					cancel()
					t.Fatal("worker did not become idle")
				case event = <-w.Events():
				}
			}
		}
		time.Sleep(50 * time.Millisecond)

		start := time.Now()
		if stopByCancel {
			cancel()
		} else {
			closeDone := make(chan error, 1)
			go func() { closeDone <- w.Close() }()
			select {
			case err := <-closeDone:
				if err != nil {
					t.Fatalf("Close: %v", err)
				}
			case <-time.After(2 * time.Second):
				cancel()
				t.Fatal("Close did not interrupt the blocking fetch")
			}
		}

		select {
		case <-runDone:
		case <-time.After(2 * time.Second):
			cancel()
			t.Fatal("Run did not stop promptly")
		}
		if elapsed := time.Since(start); elapsed > 2*time.Second {
			t.Fatalf("worker stopped after %v, want under 2s", elapsed)
		}
		if err := w.Close(); err != nil {
			t.Fatalf("Close: %v", err)
		}
		cancel()

		pingCtx, pingCancel := context.WithTimeout(context.Background(), time.Second)
		err := rdb.Ping(pingCtx).Err()
		pingCancel()
		if err != nil {
			t.Fatalf("shared Redis client was closed: %v", err)
		}
	}
}
