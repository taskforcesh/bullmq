package bullmq_test

import (
	"context"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

func TestBackendForQueueSharesTheOwnersConnections(t *testing.T) {
	forEachBackend(t, testBackendForQueueSharesTheOwnersConnections)
}

func testBackendForQueueSharesTheOwnersConnections(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	otherQ := newChildQueue(t, be)

	owner, err := be.Factory(q.Name(), bullmq.BackendOptions{})
	if err != nil {
		t.Fatalf("Factory: %v", err)
	}
	defer owner.Close()

	for _, name := range []string{otherQ.Name(), otherQ.Backend().QualifiedName()} {
		sibling, err := owner.ForQueue(name)
		if err != nil {
			t.Fatalf("ForQueue(%q): %v", name, err)
		}
		if sibling.QueueName() != otherQ.Name() || sibling.QualifiedName() != otherQ.Backend().QualifiedName() {
			t.Fatalf("ForQueue(%q) is queue %q (%q), want %q (%q)", name,
				sibling.QueueName(), sibling.QualifiedName(), otherQ.Name(), otherQ.Backend().QualifiedName())
		}
		id, err := sibling.AddJob(ctx, bullmq.NewJob{Name: "sibling", Data: []byte(`{}`), Opts: &bullmq.JobOptions{Timestamp: 1}})
		if err != nil {
			t.Fatalf("AddJob through the sibling: %v", err)
		}
		if job, err := otherQ.Job(ctx, id); err != nil || job == nil || job.Name != "sibling" {
			t.Fatalf("job added through the sibling = %+v (%v)", job, err)
		}
		// Closing the sibling leaves the shared connections open.
		if err := sibling.Close(); err != nil {
			t.Fatalf("Close sibling: %v", err)
		}
		if _, err := owner.GetCounts(ctx, []bullmq.JobState{bullmq.StateWaiting}); err != nil {
			t.Fatalf("owner after closing a sibling: %v", err)
		}
	}

	// A Redis backend only reaches the queues of its own prefix.
	if be.Name == "redis" {
		if _, err := owner.ForQueue("other-prefix:" + otherQ.Name()); err == nil {
			t.Fatal("ForQueue accepted a queue of another prefix")
		}
	}

	sibling, err := owner.ForQueue(otherQ.Name())
	if err != nil {
		t.Fatalf("ForQueue: %v", err)
	}
	if err := owner.Close(); err != nil {
		t.Fatalf("Close owner: %v", err)
	}
	closedCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if _, err := sibling.GetCounts(closedCtx, []bullmq.JobState{bullmq.StateWaiting}); err == nil {
		t.Fatal("the sibling still works after its owner was closed")
	}
}
