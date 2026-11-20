package redisbackend

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// autoPipelineModes are the two dispatch modes of go-redis's auto-pipeliner.
var autoPipelineModes = []struct {
	name string
	opts func() *redis.AutoPipelineOptions
}{
	{"half-duplex", func() *redis.AutoPipelineOptions { return &redis.AutoPipelineOptions{} }},
	{"full-duplex", func() *redis.AutoPipelineOptions { return &redis.AutoPipelineOptions{FullDuplex: true} }},
}

// batchHook records the largest pipeline a client sent. Half-duplex
// auto-pipelined batches reach the pipeline hook.
type batchHook struct {
	maxBatch atomic.Int32
}

func (h *batchHook) DialHook(next redis.DialHook) redis.DialHook {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		return next(ctx, network, addr)
	}
}

func (h *batchHook) ProcessHook(next redis.ProcessHook) redis.ProcessHook { return next }

func (h *batchHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		for {
			current := h.maxBatch.Load()
			if int32(len(cmds)) <= current || h.maxBatch.CompareAndSwap(current, int32(len(cmds))) {
				break
			}
		}
		return next(ctx, cmds)
	}
}

func newAutoPipelinedBackend(t *testing.T, opts Options) *Backend {
	t.Helper()
	if opts.Client == nil && opts.Addr == "" {
		opts.Addr = redisAddr()
	}
	if opts.AutoPipeline == nil {
		opts.AutoPipeline = &redis.AutoPipelineOptions{}
	}
	b, err := NewBackend(testQueueName(t), opts, bullmq.BackendOptions{})
	if err != nil {
		t.Fatalf("NewBackend: %v", err)
	}
	t.Cleanup(func() { _ = b.Close() })
	return b
}

// addConcurrently adds n jobs from 50 goroutines.
func addConcurrently(t *testing.T, q *bullmq.Queue, n int) {
	t.Helper()
	ctx := testContext(t)
	var next atomic.Int32
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for range 50 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for next.Add(1) <= int32(n) {
				if _, err := q.Add(ctx, "concurrent", nil, nil); err != nil {
					errs <- err
				}
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("Add: %v", err)
	}
	if got, err := q.Count(ctx); err != nil || got != int64(n) {
		t.Fatalf("Count = %d, %v; want %d", got, err, n)
	}
}

// In half-duplex mode concurrent commands share pipelines.
func TestAutoPipelineBatchesConcurrentCommands(t *testing.T) {
	requireRedis(t)
	q := newTestQueue(t, Options{AutoPipeline: &redis.AutoPipelineOptions{}})
	rb := redisOf(t, q)
	if rb.ap == nil || rb.commands != rb.ap || rb.ap.Config().FullDuplex {
		t.Fatal("the backend does not use a half-duplex auto-pipeliner")
	}
	hook := &batchHook{}
	rb.Client().AddHook(hook)

	addConcurrently(t, q, 200)
	if got := hook.maxBatch.Load(); got < 2 {
		t.Errorf("largest batch = %d commands, want concurrent adds to share a batch", got)
	}
}

// In full-duplex mode the commands stream on one held connection.
func TestAutoPipelineFullDuplex(t *testing.T) {
	requireRedis(t)
	q := newTestQueue(t, Options{AutoPipeline: &redis.AutoPipelineOptions{FullDuplex: true}})
	rb := redisOf(t, q)
	if rb.ap == nil || rb.commands != rb.ap || !rb.ap.Config().FullDuplex {
		t.Fatal("the backend does not use a full-duplex auto-pipeliner")
	}
	addConcurrently(t, q, 200)
}

func TestAutoPipelineWorkerProcessesJobs(t *testing.T) {
	requireRedis(t)
	for _, mode := range autoPipelineModes {
		t.Run(mode.name, func(t *testing.T) {
			ctx := testContext(t)
			opts := Options{AutoPipeline: mode.opts()}
			q := newTestQueue(t, opts)
			specs := make([]bullmq.JobSpec, 200)
			for i := range specs {
				specs[i] = bullmq.JobSpec{Name: "job", Data: i}
			}
			if _, err := q.AddBulk(ctx, specs); err != nil {
				t.Fatalf("AddBulk: %v", err)
			}

			var processed atomic.Int32
			w := newTestWorker(t, q.Name(), func(context.Context, *bullmq.Job) (any, error) {
				processed.Add(1)
				return "ok", nil
			}, &bullmq.WorkerOptions{Backend: testFactory(opts), Concurrency: 10})
			runWorker(t, w)
			waitFor(t, 10*time.Second, "200 completed jobs", func() bool {
				n, err := q.JobCounts(ctx, bullmq.StateCompleted)
				return err == nil && n[bullmq.StateCompleted] == 200
			})
			if got := processed.Load(); got != 200 {
				t.Fatalf("processed %d jobs, want 200", got)
			}
		})
	}
}

// The backend closes the auto-pipeliner of a client it owns. A caller's
// client has one shared auto-pipeliner, which the backend leaves open for the
// other backends (and code) using the client.
func TestAutoPipelineIsClosedOnlyWithAnOwnedClient(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)

	owned := newAutoPipelinedBackend(t, Options{})
	sibling, err := owned.forQueue(owned.QueueName() + "-sibling")
	if err != nil {
		t.Fatal(err)
	}
	if sibling.ap != owned.ap || sibling.commands != owned.commands {
		t.Error("ForQueue does not share the auto-pipeliner")
	}
	if err := sibling.Close(); err != nil || owned.ap.IsClosed() {
		t.Fatalf("closing a ForQueue backend closed the auto-pipeliner (err %v)", err)
	}
	if err := owned.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if !owned.ap.IsClosed() {
		t.Error("the auto-pipeliner of an owned client is still open after Close")
	}

	rdb := redis.NewClient(&redis.Options{Addr: redisAddr()})
	defer rdb.Close()
	first := newAutoPipelinedBackend(t, Options{Client: rdb})
	second := newAutoPipelinedBackend(t, Options{Client: rdb})
	if first.ap == nil || first.ap != second.ap {
		t.Fatal("backends on one client do not share its auto-pipeliner")
	}
	if err := first.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if first.ap.IsClosed() {
		t.Fatal("closing a backend closed the auto-pipeliner of the caller's client")
	}
	if _, err := second.AddJob(ctx, bullmq.NewJob{Name: "after-close", Data: []byte("null"), Opts: &bullmq.JobOptions{}}); err != nil {
		t.Fatalf("AddJob on the other backend: %v", err)
	}
	if err := rdb.Ping(ctx).Err(); err != nil {
		t.Fatalf("the caller's client was closed: %v", err)
	}
	_, _ = second.Obliterate(ctx, true, 1000)
}

func TestAutoPipelineFallsBackWhenTheClientCannot(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	ring := redis.NewRing(&redis.RingOptions{Addrs: map[string]string{"one": redisAddr()}})
	defer ring.Close()

	b := newAutoPipelinedBackend(t, Options{Client: ring})
	if b.ap != nil || b.commands != ring {
		t.Fatalf("backend on a Ring uses %T, want the Ring itself", b.commands)
	}
	if _, err := b.AddJob(ctx, bullmq.NewJob{Name: "ring", Data: []byte("null"), Opts: &bullmq.JobOptions{}}); err != nil {
		t.Fatalf("AddJob: %v", err)
	}
	_, _ = b.Obliterate(ctx, true, 1000)
}

func TestAutoPipelineRejectsInvalidOptions(t *testing.T) {
	_, err := NewBackend("q", Options{
		Addr:         redisAddr(),
		AutoPipeline: &redis.AutoPipelineOptions{MaxBatchSize: -1},
	}, bullmq.BackendOptions{})
	var cfgErr *bullmq.ConfigError
	if !errors.As(err, &cfgErr) {
		t.Fatalf("NewBackend error = %v, want a ConfigError", err)
	}
}

// A script missing from the server's cache comes back as a NOSCRIPT error of
// its own command, and is sent again with EVAL, as on a plain client.
func TestAutoPipelineFallsBackToEvalOnNoScript(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	for _, mode := range autoPipelineModes {
		t.Run(mode.name, func(t *testing.T) {
			b := newAutoPipelinedBackend(t, Options{AutoPipeline: mode.opts()})
			// A script body no server has seen.
			tag := fmt.Sprintf("noscript-%d", time.Now().UnixNano())
			src := "return '" + tag + "'"
			s := &luaScript{name: "probe", src: src, script: redis.NewScript(src)}

			err := b.commands.EvalSha(ctx, s.script.Hash(), nil).Err()
			if !redis.HasErrorPrefix(err, "NOSCRIPT") {
				t.Fatalf("EVALSHA error = %v, want NOSCRIPT", err)
			}
			for range 2 {
				res, err := s.run(ctx, b.commands, nil).Result()
				if err != nil || res != tag {
					t.Fatalf("run = %v, %v", res, err)
				}
			}
		})
	}
}

// A plain client sends nothing once the context is done. The auto-pipeliner
// runs queued commands on its own context, so the backend checks it before
// every non-blocking command: Lua commands, typed writes and typed reads.
func TestCancelledContextSendsNoCommand(t *testing.T) {
	requireRedis(t)
	modes := append([]struct {
		name string
		opts func() *redis.AutoPipelineOptions
	}{{"plain", func() *redis.AutoPipelineOptions { return nil }}}, autoPipelineModes...)
	for _, mode := range modes {
		t.Run(mode.name, func(t *testing.T) {
			ap := mode.opts()
			live := testContext(t)
			// Not newTestQueue: REDIS_AUTOPIPELINE must not turn the plain case on.
			q, err := bullmq.NewQueue(testQueueName(t), &bullmq.QueueOptions{
				Backend: New(Options{Addr: redisAddr(), AutoPipeline: ap}),
			})
			if err != nil {
				t.Fatalf("NewQueue: %v", err)
			}
			t.Cleanup(func() {
				_ = q.Obliterate(context.Background(), true, 1000)
				_ = q.Close()
			})
			rb := redisOf(t, q)
			if (rb.ap != nil) != (ap != nil) {
				t.Fatalf("auto-pipelining = %v, want %v", rb.ap != nil, ap != nil)
			}
			job, err := q.Add(live, "held", nil, &bullmq.JobOptions{
				Deduplication: &bullmq.DeduplicationOptions{ID: "dedup"},
			})
			if err != nil {
				t.Fatalf("Add: %v", err)
			}
			if _, err := job.Log(live, "row"); err != nil {
				t.Fatalf("Log: %v", err)
			}
			if err := q.SetGlobalRateLimit(live, 10, time.Second); err != nil {
				t.Fatalf("SetGlobalRateLimit: %v", err)
			}

			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			calls := []struct {
				name string
				call func() error
			}{
				{"Add (Lua)", func() error { _, err := q.Add(ctx, "cancelled", nil, nil); return err }},
				{"SetGlobalConcurrency (HSET)", func() error { return q.SetGlobalConcurrency(ctx, 5) }},
				{"RemoveGlobalRateLimit (HDEL)", func() error { return q.RemoveGlobalRateLimit(ctx) }},
				{"RemoveDeduplicationKey (DEL)", func() error { _, err := q.RemoveDeduplicationKey(ctx, "dedup"); return err }},
				{"SetRateLimit (SET)", func() error { return rb.SetRateLimit(ctx, time.Minute) }},
				{"GlobalRateLimit (HGET)", func() error { _, err := q.GlobalRateLimit(ctx); return err }},
				{"DeduplicationJobID (GET)", func() error { _, err := q.DeduplicationJobID(ctx, "dedup"); return err }},
				{"Job (HGETALL)", func() error { _, err := q.Job(ctx, job.ID); return err }},
				{"Logs (LRANGE)", func() error { _, _, err := job.Logs(ctx, 0, -1); return err }},
				{"ChildrenValues (HGETALL)", func() error { _, err := job.ChildrenValues(ctx); return err }},
				{"IgnoredChildrenFailures (HGETALL)", func() error { _, err := job.IgnoredChildrenFailures(ctx); return err }},
				{"IsJobScheduler (HEXISTS)", func() error { _, err := rb.IsJobScheduler(ctx, "s"); return err }},
				{"JobSchedulers (ZRANGE)", func() error { _, err := q.JobSchedulers(ctx, 0, -1, true); return err }},
				{"JobSchedulers (ZREVRANGE)", func() error { _, err := q.JobSchedulers(ctx, 0, -1, false); return err }},
				{"JobSchedulersCount (ZCARD)", func() error { _, err := q.JobSchedulersCount(ctx); return err }},
			}
			for _, c := range calls {
				if err := c.call(); !errors.Is(err, context.Canceled) {
					t.Errorf("%s error = %v, want context.Canceled", c.name, err)
				}
			}

			if n, err := q.Count(live); err != nil || n != 1 {
				t.Errorf("Count = %d, %v; want no job added", n, err)
			}
			if max, err := q.GlobalConcurrency(live); err != nil || max != 0 {
				t.Errorf("GlobalConcurrency = %d, %v; want it unset", max, err)
			}
			if rl, err := q.GlobalRateLimit(live); err != nil || rl == nil {
				t.Errorf("GlobalRateLimit = %v, %v; want it kept", rl, err)
			}
			if id, err := q.DeduplicationJobID(live, "dedup"); err != nil || id != job.ID {
				t.Errorf("DeduplicationJobID = %q, %v; want %q kept", id, err, job.ID)
			}
			if n, err := rb.Client().Exists(live, rb.Keys().Limiter()).Result(); err != nil || n != 0 {
				t.Errorf("limiter key exists = %d, %v; want it not set", n, err)
			}
		})
	}
}
