package redisbackend

import (
	"os"
	"testing"

	"github.com/redis/go-redis/v9"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// A flow must never be split around a script cache miss: its commands depend
// on each other, so resending only the commands that missed the cache would
// add the parent after its children were rejected and release it at once.
func TestAddFlowSurvivesAFlushedScriptCache(t *testing.T) {
	requireRedis(t)
	if os.Getenv("REDIS_ADDR") == "" {
		t.Skip("flushing the script cache needs a Redis server dedicated to the tests: set REDIS_ADDR")
	}
	ctx := testContext(t)
	parentQ := newTestQueue(t, Options{})
	childQ, err := bullmq.NewQueue(parentQ.Name()+"-children", &bullmq.QueueOptions{Backend: testFactory(Options{})})
	if err != nil {
		t.Fatalf("NewQueue: %v", err)
	}
	t.Cleanup(func() {
		_ = childQ.Obliterate(ctx, true, 1000)
		_ = childQ.Close()
	})

	fp, err := bullmq.NewFlowProducer(&bullmq.FlowProducerOptions{Backend: testFactory(Options{})})
	if err != nil {
		t.Fatalf("NewFlowProducer: %v", err)
	}
	defer fp.Close()
	flow := bullmq.FlowJob{
		Name: "parent", QueueName: parentQ.Name(),
		Children: []bullmq.FlowJob{
			{Name: "child", QueueName: childQ.Name()},
			{Name: "child", QueueName: childQ.Name()},
		},
	}

	// The producer has used the scripts of a flow before...
	if _, err := fp.Add(ctx, flow, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	// ...when the server loses its script cache (a restart, a failover),
	admin := redis.NewClient(&redis.Options{Addr: redisAddr()})
	defer admin.Close()
	if err := admin.ScriptFlush(ctx).Err(); err != nil {
		t.Fatalf("SCRIPT FLUSH: %v", err)
	}
	// and an ordinary producer caches addStandardJob again, but not the
	// other scripts of a flow.
	if _, err := parentQ.Add(ctx, "plain", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}

	tree, err := fp.Add(ctx, flow, nil)
	if err != nil {
		t.Fatalf("Add after the script cache was flushed: %v", err)
	}
	if state, err := parentQ.JobState(ctx, tree.Job.ID); err != nil || state != bullmq.StateWaitingChildren {
		t.Fatalf("parent state = %q (%v), want waiting-children", state, err)
	}
	for _, c := range tree.Children {
		child, err := childQ.Job(ctx, c.Job.ID)
		if err != nil || child == nil || child.ParentKey != tree.Children[0].Job.ParentKey {
			t.Fatalf("child %s = %+v (%v)", c.Job.ID, child, err)
		}
	}
	if counts, err := tree.Job.DependenciesCount(ctx); err != nil || counts.Unprocessed != 2 {
		t.Fatalf("parent dependencies = %+v (%v), want 2 unprocessed", counts, err)
	}
	counts, err := parentQ.JobCounts(ctx, bullmq.StateWaiting, bullmq.StateWaitingChildren)
	if err != nil || counts[bullmq.StateWaiting] != 1 || counts[bullmq.StateWaitingChildren] != 2 {
		t.Fatalf("parent queue counts = %v (%v), want 1 waiting and 2 waiting-children", counts, err)
	}
}
