package bullmq_test

import (
	"context"
	"errors"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// processParentAndWaitForFailure runs a worker on q whose processor runs fn
// and then returns successfully, and returns the error the job failed with.
func processParentAndWaitForFailure(t *testing.T, be testBackend, q *bullmq.Queue, fn func(ctx context.Context, job *bullmq.Job) error) error {
	t.Helper()
	failed := make(chan error, 1)
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		if err := fn(ctx, job); err != nil {
			t.Errorf("processor: %v", err)
		}
		return "done", nil
	}, &bullmq.WorkerOptions{OnEvent: func(ev bullmq.Event) {
		if ev.Type == bullmq.EventFailed {
			select {
			case failed <- ev.Err:
			default:
			}
		}
	}})
	runWorker(t, w)
	select {
	case err := <-failed:
		return err
	case <-time.After(15 * time.Second):
		t.Fatal("the parent was not failed")
		return nil
	}
}

func requireFailedWith(t *testing.T, ctx context.Context, q *bullmq.Queue, id string, err, sentinel error, want string) {
	t.Helper()
	if err == nil || err.Error() != want || !errors.Is(err, sentinel) {
		t.Fatalf("failure = %v, want %q wrapping %v", err, want, sentinel)
	}
	waitFor(t, 10*time.Second, "the parent to be failed", func() bool {
		s, _ := q.JobState(ctx, id)
		return s == bullmq.StateFailed
	})
	stored, serr := q.Job(ctx, id)
	if serr != nil || stored == nil || stored.FailedReason != want {
		t.Fatalf("stored parent = %+v (%v), want failed reason %q", stored, serr, want)
	}
}

func TestParentCompletingWithPendingChildrenFails(t *testing.T) {
	forEachBackend(t, testParentCompletingWithPendingChildrenFails)
}

func testParentCompletingWithPendingChildrenFails(t *testing.T, be testBackend) {
	ctx := testContext(t)
	parentQ := newTestQueue(t, be, nil)
	childQ := newChildQueue(t, be)

	parent, err := parentQ.Add(ctx, "parent", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	// The child is added while the parent runs and is never processed, so
	// completing the parent is refused.
	failure := processParentAndWaitForFailure(t, be, parentQ, func(ctx context.Context, job *bullmq.Job) error {
		_, err := childQ.Add(ctx, "child", nil, &bullmq.JobOptions{
			Parent: &bullmq.ParentOptions{ID: job.ID, Queue: job.QueueName},
		})
		return err
	})
	requireFailedWith(t, ctx, parentQ, parent.ID, failure, bullmq.ErrJobPendingDependencies,
		"Job "+parent.ID+" has pending dependencies. moveToFinished")
}

func TestParentCompletingWithAFailedChildFails(t *testing.T) {
	forEachBackend(t, testParentCompletingWithAFailedChildFails)
}

func testParentCompletingWithAFailedChildFails(t *testing.T, be testBackend) {
	ctx := testContext(t)
	parentQ := newTestQueue(t, be, nil)
	childQ := newChildQueue(t, be)

	parent, err := parentQ.Add(ctx, "parent", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	runWorker(t, newTestWorker(t, be, childQ.Name(), func(context.Context, *bullmq.Job) (any, error) {
		return nil, errors.New("boom")
	}, nil))
	// The child fails its parent while the parent is still running.
	failure := processParentAndWaitForFailure(t, be, parentQ, func(ctx context.Context, job *bullmq.Job) error {
		child, err := childQ.Add(ctx, "child", nil, &bullmq.JobOptions{
			Parent:              &bullmq.ParentOptions{ID: job.ID, Queue: job.QueueName},
			FailParentOnFailure: bullmq.Bool(true),
		})
		if err != nil {
			return err
		}
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			if s, _ := childQ.JobState(ctx, child.ID); s == bullmq.StateFailed {
				return nil
			}
			time.Sleep(10 * time.Millisecond)
		}
		return errors.New("the child did not fail")
	})
	requireFailedWith(t, ctx, parentQ, parent.ID, failure, bullmq.ErrJobHasFailedChildren,
		"Cannot complete job "+parent.ID+" because it has at least one failed child. moveToFinished")
}
