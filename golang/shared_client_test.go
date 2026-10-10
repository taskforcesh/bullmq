package bullmq_test

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	bullmq "github.com/taskforcesh/bullmq/golang"
)

// A caller-supplied client whose read timeout is shorter than DrainDelay must
// not produce I/O errors while the queue is idle.
func TestWorkerSharedClientShortReadTimeout(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{
		Addr:        redisAddr(),
		ReadTimeout: 300 * time.Millisecond,
	})
	defer rdb.Close()

	var errCount atomic.Int32
	w := newTestWorker(t, testQueueName(t), func(ctx context.Context, job *bullmq.Job) (any, error) {
		return nil, nil
	}, &bullmq.WorkerOptions{
		Redis:      bullmq.RedisOptions{Client: rdb},
		DrainDelay: 1500 * time.Millisecond,
		OnError:    func(error) { errCount.Add(1) },
	})
	runWorker(t, w)

	time.Sleep(2500 * time.Millisecond)
	if n := errCount.Load(); n != 0 {
		t.Fatalf("expected no errors while idle, got %d", n)
	}
}
