package redisbackend

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// redisAddr is the server used by the integration tests.
func redisAddr() string {
	if addr := os.Getenv("REDIS_ADDR"); addr != "" {
		return addr
	}
	return "127.0.0.1:6379"
}

// requireRedis skips the test when no Redis server is reachable.
func requireRedis(t *testing.T) {
	t.Helper()
	rdb := redis.NewClient(&redis.Options{Addr: redisAddr()})
	defer rdb.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Skipf("redis is not available at %s: %v", redisAddr(), err)
	}
}

// testQueueName returns a queue name unique to the running test.
func testQueueName(t *testing.T) string {
	t.Helper()
	name := strings.NewReplacer("/", "-", " ", "-", ":", "-").Replace(t.Name())
	return "go-test-" + name + "-" + time.Now().Format("150405.000000")
}

// testAutoPipeline returns the auto-pipelining options the tests use unless
// they set their own, from REDIS_AUTOPIPELINE as in internal/testbackends:
// "fullduplex" for the full-duplex mode, any other value but "" or "0" for
// go-redis's defaults.
func testAutoPipeline() *redis.AutoPipelineOptions {
	switch v := os.Getenv("REDIS_AUTOPIPELINE"); v {
	case "", "0":
		return nil
	case "fullduplex":
		return &redis.AutoPipelineOptions{FullDuplex: true}
	default:
		return &redis.AutoPipelineOptions{}
	}
}

// testFactory returns a backend factory for opts, connecting to the test
// server unless opts supplies a client or an address.
func testFactory(opts Options) bullmq.BackendFactory {
	if opts.Client == nil && opts.Addr == "" {
		opts.Addr = redisAddr()
	}
	if opts.AutoPipeline == nil {
		opts.AutoPipeline = testAutoPipeline()
	}
	return New(opts)
}

// newTestQueue creates a queue that is obliterated when the test ends.
func newTestQueue(t *testing.T, opts Options) *bullmq.Queue {
	t.Helper()
	q, err := bullmq.NewQueue(testQueueName(t), &bullmq.QueueOptions{Backend: testFactory(opts)})
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

// redisOf returns the Redis backend of q.
func redisOf(t *testing.T, q *bullmq.Queue) *Backend {
	t.Helper()
	rb, ok := q.Backend().(*Backend)
	if !ok {
		t.Fatalf("queue backend is %T, want *redisbackend.Backend", q.Backend())
	}
	return rb
}

// newTestWorker creates a worker for queueName. Start it with runWorker,
// which also stops it when the test ends.
func newTestWorker(t *testing.T, queueName string, proc bullmq.Processor, opts *bullmq.WorkerOptions) *bullmq.Worker {
	t.Helper()
	if opts == nil {
		opts = &bullmq.WorkerOptions{}
	}
	if opts.Backend == nil {
		opts.Backend = testFactory(Options{})
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
