package bullmq_test

import (
	"context"
	"net"
	"sync/atomic"
	"testing"

	"github.com/redis/go-redis/v9"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// scriptHook records the script commands sent in pipelines and can flush the
// server's script cache right before the next EVALSHA transaction runs.
type scriptHook struct {
	admin     *redis.Client
	evalSHAs  atomic.Int32
	evals     atomic.Int32
	flushNext atomic.Bool
}

func (h *scriptHook) DialHook(next redis.DialHook) redis.DialHook {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		return next(ctx, network, addr)
	}
}

func (h *scriptHook) ProcessHook(next redis.ProcessHook) redis.ProcessHook { return next }

func (h *scriptHook) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return func(ctx context.Context, cmds []redis.Cmder) error {
		sha := 0
		for _, c := range cmds {
			switch c.Name() {
			case "evalsha":
				sha++
			case "eval":
				h.evals.Add(1)
			}
		}
		h.evalSHAs.Add(int32(sha))
		if sha > 0 && h.flushNext.CompareAndSwap(true, false) {
			if err := h.admin.ScriptFlush(context.Background()).Err(); err != nil {
				return err
			}
		}
		return next(ctx, cmds)
	}
}

func newHookedQueue(t *testing.T) (*bullmq.Queue, *scriptHook) {
	t.Helper()
	hook := &scriptHook{admin: redis.NewClient(&redis.Options{Addr: redisAddr()})}
	t.Cleanup(func() { _ = hook.admin.Close() })
	client := redis.NewClient(&redis.Options{Addr: redisAddr()})
	client.AddHook(hook)
	t.Cleanup(func() { _ = client.Close() })
	return newTestQueue(t, &bullmq.QueueOptions{Redis: bullmq.RedisOptions{Client: client}}), hook
}

func bulkSpecs(n int) []bullmq.JobSpec {
	specs := make([]bullmq.JobSpec, 0, n+2)
	for i := range n {
		specs = append(specs, bullmq.JobSpec{Name: "bulk", Data: i})
	}
	specs = append(specs,
		bullmq.JobSpec{Name: "prio", Opts: &bullmq.JobOptions{Priority: bullmq.Int64(2)}},
		bullmq.JobSpec{Name: "later", Opts: &bullmq.JobOptions{Delay: bullmq.Int64(60_000)}},
	)
	return specs
}

func TestAddBulkSendsEvalSHAInsteadOfScriptText(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q, hook := newHookedQueue(t)
	if err := hook.admin.ScriptFlush(ctx).Err(); err != nil {
		t.Fatalf("ScriptFlush: %v", err)
	}

	specs := bulkSpecs(20)
	jobs, err := q.AddBulk(ctx, specs)
	if err != nil {
		t.Fatalf("AddBulk: %v", err)
	}
	if len(jobs) != len(specs) {
		t.Fatalf("len(jobs) = %d, want %d", len(jobs), len(specs))
	}
	if got := hook.evals.Load(); got != 0 {
		t.Errorf("EVAL commands = %d, want 0", got)
	}
	if got := hook.evalSHAs.Load(); got != int32(len(specs)) {
		t.Errorf("EVALSHA commands = %d, want %d", got, len(specs))
	}
}

func TestAddBulkRecoversFromScriptCacheMissWithoutReplayingJobs(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q, hook := newHookedQueue(t)

	// The cache is flushed after the scripts are loaded but before the
	// transaction runs, so every EVALSHA in it answers NOSCRIPT.
	hook.flushNext.Store(true)
	specs := bulkSpecs(10)
	jobs, err := q.AddBulk(ctx, specs)
	if err != nil {
		t.Fatalf("AddBulk: %v", err)
	}

	seen := map[string]bool{}
	for _, j := range jobs {
		if seen[j.ID] {
			t.Fatalf("duplicate job id %s", j.ID)
		}
		seen[j.ID] = true
	}
	counts, err := q.JobCounts(ctx, bullmq.StateWaiting, bullmq.StatePrioritized, bullmq.StateDelayed)
	if err != nil {
		t.Fatalf("JobCounts: %v", err)
	}
	if counts[bullmq.StateWaiting] != 10 || counts[bullmq.StatePrioritized] != 1 || counts[bullmq.StateDelayed] != 1 {
		t.Errorf("counts = %v, want 10 waiting, 1 prioritized, 1 delayed", counts)
	}
	// Retried commands fall back to full scripts; none are sent twice as EVALSHA.
	if got := hook.evals.Load(); got != int32(len(specs)) {
		t.Errorf("EVAL fallbacks = %d, want %d", got, len(specs))
	}
}
