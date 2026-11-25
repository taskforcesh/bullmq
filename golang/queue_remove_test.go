package bullmq_test

import (
	"context"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// Queue.Remove removes a job by id, as Node's queue.remove does.
func TestQueueRemove(t *testing.T) {
	forEachBackend(t, testQueueRemove)
}

func testQueueRemove(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	job, err := q.Add(ctx, "removable", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if removed, err := q.Remove(ctx, job.ID, false); err != nil || !removed {
		t.Fatalf("Remove = %v, %v; want true", removed, err)
	}
	requireJobGone(t, ctx, q, job.ID)
	if removed, err := q.Remove(ctx, "missing", false); err != nil || !removed {
		t.Fatalf("Remove(missing) = %v, %v; want true", removed, err)
	}

	// With removeChildren, the children go too.
	fp := newTestFlowProducer(t, be)
	tree, err := fp.Add(ctx, bullmq.FlowJob{Name: "parent", QueueName: q.Name(), Children: []bullmq.FlowJob{
		{Name: "child", QueueName: q.Name(), Opts: &bullmq.JobOptions{Delay: bullmq.Int64(60_000)}},
	}}, nil)
	if err != nil {
		t.Fatalf("FlowProducer.Add: %v", err)
	}
	if removed, err := q.Remove(ctx, tree.Job.ID, true); err != nil || !removed {
		t.Fatalf("Remove(parent) = %v, %v; want true", removed, err)
	}
	requireJobGone(t, ctx, q, tree.Job.ID)
	requireJobGone(t, ctx, q, tree.Children[0].Job.ID)

	// A job a worker holds is not removed.
	started := make(chan struct{})
	release := make(chan struct{})
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, _ *bullmq.Job) (any, error) {
		close(started)
		select {
		case <-release:
		case <-ctx.Done():
		}
		return nil, nil
	}, nil)
	runWorker(t, w)
	busy, err := q.Add(ctx, "busy", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	select {
	case <-started:
	case <-time.After(10 * time.Second):
		t.Fatal("the job was not processed")
	}
	removed, err := q.Remove(ctx, busy.ID, false)
	close(release)
	if err != nil || removed {
		t.Fatalf("Remove(active) = %v, %v; want false", removed, err)
	}
	if stored, err := q.Job(ctx, busy.ID); err != nil || stored == nil {
		t.Fatalf("Job(%s) = %v, %v; want the job kept", busy.ID, stored, err)
	}
}
