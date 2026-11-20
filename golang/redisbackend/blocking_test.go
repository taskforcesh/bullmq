package redisbackend

import (
	"context"
	"errors"
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// commandCounter counts the commands of one name sent through a client.
type commandCounter struct {
	name  string
	count atomic.Int32
}

func (c *commandCounter) DialHook(next redis.DialHook) redis.DialHook {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		return next(ctx, network, addr)
	}
}

func (c *commandCounter) ProcessHook(next redis.ProcessHook) redis.ProcessHook {
	return func(ctx context.Context, cmd redis.Cmder) error {
		if strings.EqualFold(cmd.Name(), c.name) {
			c.count.Add(1)
		}
		return next(ctx, cmd)
	}
}

func (c *commandCounter) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		for _, cmd := range cmds {
			if strings.EqualFold(cmd.Name(), c.name) {
				c.count.Add(1)
			}
		}
		return next(ctx, cmds)
	}
}

// newBlockingTestBackend builds a backend with a dedicated blocking client
// for queue, counting the commands called name sent through that client.
func newBlockingTestBackend(t *testing.T, queue string, blockTimeout time.Duration, name string) (*Backend, *commandCounter) {
	t.Helper()
	b, err := NewBackend(queue, Options{Addr: redisAddr(), AutoPipeline: testAutoPipeline()}, bullmq.BackendOptions{
		WithBlockingConnection: true,
		ClientNameSuffix:       ":w:blocking-test",
		BlockTimeout:           blockTimeout,
	})
	if err != nil {
		t.Fatalf("NewBackend: %v", err)
	}
	t.Cleanup(func() { _ = b.Close() })
	if b.blockingConn == nil {
		t.Fatal("the backend has no dedicated blocking client")
	}
	counter := &commandCounter{name: name}
	b.blocking.AddHook(counter)
	return b, counter
}

// An idle wait is one blocking command for the whole timeout, not one per
// second.
func TestWaitForJobBlocksForTheWholeTimeout(t *testing.T) {
	requireRedis(t)
	q := newTestQueue(t, Options{})
	b, bzpopmin := newBlockingTestBackend(t, q.Name(), 5*time.Second, "bzpopmin")

	start := time.Now()
	res, err := b.WaitForJob(context.Background(), 2500*time.Millisecond)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("WaitForJob: %v", err)
	}
	if res.Woken {
		t.Fatalf("WaitForJob on an idle queue = %+v, want a timeout", res)
	}
	if elapsed < 2400*time.Millisecond || elapsed > 4*time.Second {
		t.Errorf("WaitForJob(2.5s) returned after %v", elapsed)
	}
	if n := bzpopmin.count.Load(); n != 1 {
		t.Errorf("BZPOPMIN sent %d times for one wait, want 1", n)
	}
}

// Cancelling the context interrupts a long blocking wait at once, and the
// backend keeps working (on a new, named connection) afterwards.
func TestWaitForJobIsInterruptedByCancellation(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, Options{})
	b, _ := newBlockingTestBackend(t, q.Name(), time.Minute, "bzpopmin")

	waitCtx, cancel := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() {
		_, err := b.WaitForJob(waitCtx, time.Minute)
		done <- err
	}()
	time.Sleep(200 * time.Millisecond)
	start := time.Now()
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("WaitForJob after cancellation: err = %v, want context.Canceled", err)
		}
		if elapsed := time.Since(start); elapsed > 300*time.Millisecond {
			t.Errorf("WaitForJob returned %v after its context was cancelled", elapsed)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("WaitForJob did not return after its context was cancelled")
	}

	if _, err := q.Add(ctx, "after", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	res, err := b.WaitForJob(ctx, 5*time.Second)
	if err != nil || !res.Woken {
		t.Fatalf("WaitForJob after an interrupted wait = %+v, %v; want woken", res, err)
	}
	list, err := redisOf(t, q).Client().ClientList(ctx).Result()
	if err != nil {
		t.Fatalf("CLIENT LIST: %v", err)
	}
	if name := b.ClientName(":w:blocking-test"); !strings.Contains(list, "name="+name+" ") {
		t.Errorf("no connection named %s after reconnecting", name)
	}
}

// Cancelling the context also interrupts a blocking read of the event
// stream, so QueueEvents stops promptly.
func TestReadEventsIsInterruptedByCancellation(t *testing.T) {
	requireRedis(t)
	q := newTestQueue(t, Options{})
	b, _ := newBlockingTestBackend(t, q.Name(), time.Minute, "xread")

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := b.ReadEvents(ctx, "$", time.Minute)
		done <- err
	}()
	time.Sleep(200 * time.Millisecond)
	start := time.Now()
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("ReadEvents after cancellation: err = %v, want context.Canceled", err)
		}
		if elapsed := time.Since(start); elapsed > 300*time.Millisecond {
			t.Errorf("ReadEvents returned %v after its context was cancelled", elapsed)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ReadEvents did not return after its context was cancelled")
	}
}
