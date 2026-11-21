package redisbackend

import (
	"context"
	"testing"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// Workers, queue events listeners and flow producers expose their backend;
// the blocking client of a worker or a listener is its dedicated connection.
func TestBackendAccessors(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	factory := testFactory(Options{})
	name := testQueueName(t)

	w, err := bullmq.NewWorker(name, func(context.Context, *bullmq.Job) (any, error) { return nil, nil },
		&bullmq.WorkerOptions{Backend: factory})
	if err != nil {
		t.Fatalf("NewWorker: %v", err)
	}
	defer w.Close()
	qe, err := bullmq.NewQueueEvents(name, &bullmq.QueueEventsOptions{Backend: factory})
	if err != nil {
		t.Fatalf("NewQueueEvents: %v", err)
	}
	defer qe.Close()
	fp, err := bullmq.NewFlowProducer(&bullmq.FlowProducerOptions{Backend: factory})
	if err != nil {
		t.Fatalf("NewFlowProducer: %v", err)
	}
	defer fp.Close()

	for what, b := range map[string]bullmq.Backend{"Worker": w.Backend(), "QueueEvents": qe.Backend()} {
		rb, ok := b.(*Backend)
		if !ok || rb.QueueName() != name {
			t.Fatalf("%s.Backend() = %T, want the *Backend of %s", what, b, name)
		}
		blocking := rb.BlockingClient()
		if blocking == nil || blocking == rb.Client() {
			t.Errorf("%s: BlockingClient is not a dedicated client", what)
		}
		if err := blocking.Ping(ctx).Err(); err != nil {
			t.Errorf("%s: BlockingClient: %v", what, err)
		}
	}
	rb, ok := fp.Backend().(*Backend)
	if !ok || rb.BlockingClient() != rb.Client() {
		t.Errorf("FlowProducer.Backend() = %T, want a *Backend without a dedicated blocking client", fp.Backend())
	}
}
