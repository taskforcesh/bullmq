package redisbackend

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"net"
	"sync/atomic"
	"testing"

	"github.com/redis/go-redis/v9"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// unknownSHA is a script digest no server has cached.
const unknownSHA = "0000000000000000000000000000000000000000"

// scriptHook records the script commands sent in pipelines and can make the
// next EVALSHA transaction miss the script cache. It rewrites the digests of
// that transaction instead of flushing the server's script cache, which other
// clients of the shared test server rely on.
type scriptHook struct {
	evalSHAs    atomic.Int32
	evals       atomic.Int32
	scriptLoads atomic.Int32
	missNext    atomic.Bool
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
			case "script":
				h.scriptLoads.Add(1)
			}
		}
		h.evalSHAs.Add(int32(sha))
		if sha > 0 && h.missNext.CompareAndSwap(true, false) {
			for _, c := range cmds {
				if c.Name() == "evalsha" {
					c.Args()[1] = unknownSHA
				}
			}
		}
		return next(ctx, cmds)
	}
}

func newHookedQueue(t *testing.T) (*bullmq.Queue, *scriptHook) {
	t.Helper()
	hook := &scriptHook{}
	client := redis.NewClient(&redis.Options{Addr: redisAddr()})
	client.AddHook(hook)
	t.Cleanup(func() { _ = client.Close() })
	return newTestQueue(t, Options{Client: client}), hook
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

	// Every EVALSHA of the transaction answers NOSCRIPT, as if the cache had
	// been flushed after the scripts were loaded (for example by a failover).
	hook.missNext.Store(true)
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

// Scripts are loaded the first time a backend needs them, not on every bulk
// add, so later bulk adds are a single round trip.
func TestAddBulkLoadsEachScriptOnce(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q, hook := newHookedQueue(t)

	specs := bulkSpecs(5)
	for range 3 {
		if _, err := q.AddBulk(ctx, specs); err != nil {
			t.Fatalf("AddBulk: %v", err)
		}
	}
	// One SCRIPT LOAD per distinct add command: standard, prioritized and
	// delayed.
	if got := hook.scriptLoads.Load(); got != 3 {
		t.Errorf("SCRIPT LOAD commands = %d over three bulk adds, want 3", got)
	}
	if got := hook.evals.Load(); got != 0 {
		t.Errorf("EVAL commands = %d, want 0", got)
	}
}

// A cache miss means the server lost its scripts, so the backend loads every
// script again before using it, not only the ones that missed.
func TestAddBulkReloadsScriptsAfterACacheMiss(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q, hook := newHookedQueue(t)

	if _, err := q.AddBulk(ctx, bulkSpecs(2)); err != nil {
		t.Fatalf("AddBulk: %v", err)
	}
	loads := hook.scriptLoads.Load()

	hook.missNext.Store(true)
	if _, err := q.AddBulk(ctx, []bullmq.JobSpec{{Name: "plain"}}); err != nil {
		t.Fatalf("AddBulk: %v", err)
	}
	if got := hook.scriptLoads.Load(); got != loads {
		t.Fatalf("SCRIPT LOAD commands = %d after the miss, want %d: the EVAL fallback caches the script", got, loads)
	}

	// The prioritized and delayed scripts are loaded again; the standard one,
	// cached by its EVAL fallback, is not.
	if _, err := q.AddBulk(ctx, bulkSpecs(2)); err != nil {
		t.Fatalf("AddBulk: %v", err)
	}
	if got := hook.scriptLoads.Load(); got != loads+2 {
		t.Errorf("SCRIPT LOAD commands = %d, want %d", got, loads+2)
	}
}

// Since go-redis v9.19, redis.Script.Load stores the reply as the script's
// digest, and a pipelined reply is still empty when Load returns: loading the
// scripts of a bulk add through it would leave every later EVALSHA of those
// scripts with an empty digest.
func TestAddBulkKeepsTheScriptDigests(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	q := newTestQueue(t, Options{})

	if _, err := q.AddBulk(ctx, bulkSpecs(2)); err != nil {
		t.Fatalf("AddBulk: %v", err)
	}
	for _, name := range []string{"addStandardJob", "addPrioritizedJob", "addDelayedJob"} {
		s, err := getScript(name)
		if err != nil {
			t.Fatal(err)
		}
		sum := sha1.Sum([]byte(s.src))
		if got, want := s.script.Hash(), hex.EncodeToString(sum[:]); got != want {
			t.Errorf("%s digest = %q, want %q", name, got, want)
		}
	}
}
