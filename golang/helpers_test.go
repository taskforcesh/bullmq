package bullmq_test

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq/golang"
)

// redisAddr is the server used by the integration tests.
func redisAddr() string {
	if addr := os.Getenv("REDIS_ADDR"); addr != "" {
		return addr
	}
	return "127.0.0.1:6379"
}

func redisOptions() bullmq.RedisOptions {
	return bullmq.RedisOptions{Addr: redisAddr()}
}

// testQueueName returns a queue name unique to the running test.
func testQueueName(t *testing.T) string {
	t.Helper()
	name := strings.NewReplacer("/", "-", " ", "-", ":", "-").Replace(t.Name())
	return "go-test-" + name + "-" + time.Now().Format("150405.000000")
}

// newTestQueue creates a queue that is obliterated when the test ends.
func newTestQueue(t *testing.T, opts *bullmq.QueueOptions) *bullmq.Queue {
	t.Helper()
	if opts == nil {
		opts = &bullmq.QueueOptions{}
	}
	if opts.Redis.Addr == "" && opts.Redis.Client == nil {
		opts.Redis = redisOptions()
	}
	q, err := bullmq.NewQueue(testQueueName(t), opts)
	if err != nil {
		t.Fatalf("NewQueue: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = q.Obliterate(ctx, true, 1000)
		_ = q.Close()
	})
	return q
}

// newTestWorker creates a worker for queueName and closes it when the test ends.
func newTestWorker(t *testing.T, queueName string, proc bullmq.Processor, opts *bullmq.WorkerOptions) *bullmq.Worker {
	t.Helper()
	if opts == nil {
		opts = &bullmq.WorkerOptions{}
	}
	if opts.Redis.Addr == "" && opts.Redis.Client == nil {
		opts.Redis = redisOptions()
	}
	if opts.DrainDelay == 0 {
		opts.DrainDelay = 200 * time.Millisecond
	}
	if opts.StalledInterval == 0 {
		opts.StalledInterval = 2 * time.Second
	}
	w, err := bullmq.NewWorker(queueName, proc, opts)
	if err != nil {
		t.Fatalf("NewWorker: %v", err)
	}
	return w
}

// runWorker starts w in the background and stops it when the test ends.
func runWorker(t *testing.T, w *bullmq.Worker) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		_ = w.Run(ctx)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-stopped:
		case <-time.After(10 * time.Second):
			t.Error("worker did not stop in time")
		}
		_ = w.Close()
	})
}

// requireRedis skips the test when no Redis server is reachable.
func requireRedis(t *testing.T) {
	t.Helper()
	q, err := bullmq.NewQueue("go-test-ping", &bullmq.QueueOptions{Redis: redisOptions()})
	if err != nil {
		t.Fatalf("NewQueue: %v", err)
	}
	defer q.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := q.Client().Ping(ctx).Err(); err != nil {
		t.Skipf("redis is not available at %s: %v", redisAddr(), err)
	}
}

// waitFor polls cond until it returns true or the timeout elapses.
func waitFor(t *testing.T, timeout time.Duration, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out after %s waiting for %s", timeout, what)
}

func testContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	return ctx
}
