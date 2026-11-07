package bullmq_test

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// newChildQueue creates a second queue, distinct from the parent's, whose
// jobs are children of a parent job.
func newChildQueue(t *testing.T) *bullmq.Queue {
	t.Helper()
	q, err := bullmq.NewQueue(testQueueName(t)+"-children", &bullmq.QueueOptions{Redis: redisOptions()})
	if err != nil {
		t.Fatalf("NewQueue: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = q.Obliterate(ctx, true, 1000)
		_ = q.Close()
	})
	return q
}

func addChild(t *testing.T, ctx context.Context, childQ, parentQ *bullmq.Queue, parent *bullmq.Job, name string) *bullmq.Job {
	t.Helper()
	child, err := childQ.Add(ctx, name, nil, &bullmq.JobOptions{
		Parent: &bullmq.ParentOptions{ID: parent.ID, Queue: parentQ.Backend().QualifiedName()},
	})
	if err != nil {
		t.Fatalf("Add child %s: %v", name, err)
	}
	return child
}

func childKeys(childQ *bullmq.Queue, child *bullmq.Job) *bullmq.ParentKeys {
	return &bullmq.ParentKeys{ID: child.ID, QueueKey: childQ.Backend().QualifiedName()}
}

// processParentOnce processes the single parent job in q with fn, which runs
// while the job is active and holds its lock.
func processParentOnce(t *testing.T, q *bullmq.Queue, fn func(ctx context.Context, job *bullmq.Job) error) {
	t.Helper()
	done := make(chan struct{})
	w := newTestWorker(t, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		defer close(done)
		return nil, fn(ctx, job)
	}, nil)
	runWorker(t, w)
	select {
	case <-done:
	case <-time.After(15 * time.Second):
		t.Fatal("parent was not processed in time")
	}
}

func requireState(t *testing.T, ctx context.Context, q *bullmq.Queue, id string, want bullmq.JobState) {
	t.Helper()
	got, err := q.JobState(ctx, id)
	if err != nil {
		t.Fatalf("JobState: %v", err)
	}
	if got != want {
		t.Fatalf("state of %s = %q, want %q", id, got, want)
	}
}

func TestMoveToWaitingChildrenParksParentWithPendingChild(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	parentQ := newTestQueue(t, nil)
	childQ := newChildQueue(t)

	parent, err := parentQ.Add(ctx, "parent", nil, nil)
	if err != nil {
		t.Fatalf("Add parent: %v", err)
	}
	child := addChild(t, ctx, childQ, parentQ, parent, "child")

	var moved bool
	processParentOnce(t, parentQ, func(ctx context.Context, job *bullmq.Job) error {
		var err error
		moved, err = job.MoveToWaitingChildren(ctx, childKeys(childQ, child))
		if err != nil {
			t.Errorf("MoveToWaitingChildren: %v", err)
		}
		return bullmq.ErrWaitingChildren
	})
	if !moved {
		t.Fatal("MoveToWaitingChildren = false, want true with a pending child")
	}

	requireState(t, ctx, parentQ, parent.ID, bullmq.StateWaitingChildren)
	if n, err := parentQ.Client().LLen(ctx, parentQ.Keys().Active()).Result(); err != nil || n != 0 {
		t.Fatalf("active list length = %d (%v), want 0", n, err)
	}
	if lock, err := parentQ.Client().Exists(ctx, parentQ.Keys().JobLock(parent.ID)).Result(); err != nil || lock != 0 {
		t.Fatalf("lock exists = %d (%v), want 0 after parking", lock, err)
	}
}

func TestMoveToWaitingChildrenWithoutSpecificChildParksOnAnyPendingDependency(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	parentQ := newTestQueue(t, nil)
	childQ := newChildQueue(t)

	parent, err := parentQ.Add(ctx, "parent", nil, nil)
	if err != nil {
		t.Fatalf("Add parent: %v", err)
	}
	addChild(t, ctx, childQ, parentQ, parent, "child")

	var moved bool
	processParentOnce(t, parentQ, func(ctx context.Context, job *bullmq.Job) error {
		var err error
		moved, err = job.MoveToWaitingChildren(ctx, nil)
		if err != nil {
			t.Errorf("MoveToWaitingChildren: %v", err)
		}
		return bullmq.ErrWaitingChildren
	})
	if !moved {
		t.Fatal("MoveToWaitingChildren(nil) = false, want true with a pending child")
	}
	requireState(t, ctx, parentQ, parent.ID, bullmq.StateWaitingChildren)
}

func TestMoveToWaitingChildrenReturnsFalseWithoutDependencies(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	parentQ := newTestQueue(t, nil)
	childQ := newChildQueue(t)

	if _, err := parentQ.Add(ctx, "parent", nil, nil); err != nil {
		t.Fatalf("Add parent: %v", err)
	}
	// A job that is not a child of the parent.
	stranger, err := childQ.Add(ctx, "stranger", nil, nil)
	if err != nil {
		t.Fatalf("Add stranger: %v", err)
	}

	processParentOnce(t, parentQ, func(ctx context.Context, job *bullmq.Job) error {
		for name, child := range map[string]*bullmq.ParentKeys{
			"nil child":      nil,
			"unknown child":  childKeys(childQ, stranger),
			"empty child id": {QueueKey: childQ.Backend().QualifiedName()},
		} {
			moved, err := job.MoveToWaitingChildren(ctx, child)
			if err != nil || moved {
				t.Errorf("%s: moved = %v, err = %v; want false, nil", name, moved, err)
			}
		}
		if state, err := job.State(ctx); err != nil || state != bullmq.StateActive {
			t.Errorf("state = %q (%v), want active", state, err)
		}
		return nil
	})
}

func TestMoveToWaitingChildrenIgnoresChildThatIsNotPending(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	parentQ := newTestQueue(t, nil)
	childQ := newChildQueue(t)

	parent, err := parentQ.Add(ctx, "parent", nil, nil)
	if err != nil {
		t.Fatalf("Add parent: %v", err)
	}
	pending := addChild(t, ctx, childQ, parentQ, parent, "pending")
	stranger, err := childQ.Add(ctx, "stranger", nil, nil)
	if err != nil {
		t.Fatalf("Add stranger: %v", err)
	}

	processParentOnce(t, parentQ, func(ctx context.Context, job *bullmq.Job) error {
		// The parent has a pending dependency, but not on this job.
		moved, err := job.MoveToWaitingChildren(ctx, childKeys(childQ, stranger))
		if err != nil || moved {
			t.Errorf("unrelated child: moved = %v, err = %v; want false, nil", moved, err)
		}
		if state, err := job.State(ctx); err != nil || state != bullmq.StateActive {
			t.Errorf("state = %q (%v), want active", state, err)
		}
		moved, err = job.MoveToWaitingChildren(ctx, childKeys(childQ, pending))
		if err != nil || !moved {
			t.Errorf("pending child: moved = %v, err = %v; want true, nil", moved, err)
		}
		return bullmq.ErrWaitingChildren
	})
	requireState(t, ctx, parentQ, parent.ID, bullmq.StateWaitingChildren)
}

func TestMoveToWaitingChildrenRequiresTheJobLock(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	parentQ := newTestQueue(t, nil)
	childQ := newChildQueue(t)

	parent, err := parentQ.Add(ctx, "parent", nil, nil)
	if err != nil {
		t.Fatalf("Add parent: %v", err)
	}
	child := addChild(t, ctx, childQ, parentQ, parent, "child")
	keys := childKeys(childQ, child)

	processParentOnce(t, parentQ, func(ctx context.Context, job *bullmq.Job) error {
		// Mismatched token: the lock exists but belongs to someone else.
		moved, err := parentQ.Backend().MoveToWaitingChildren(ctx, job.ID, "not-the-token", keys)
		if !errors.Is(err, bullmq.ErrJobLockMismatch) || moved {
			t.Errorf("mismatched token: moved = %v, err = %v; want ErrJobLockMismatch", moved, err)
		}
		if state, err := job.State(ctx); err != nil || state != bullmq.StateActive {
			t.Errorf("state after mismatch = %q (%v), want active", state, err)
		}

		// Missing lock: it expired or was removed.
		lockKey := parentQ.Keys().JobLock(job.ID)
		if err := parentQ.Client().Del(ctx, lockKey).Err(); err != nil {
			t.Errorf("Del lock: %v", err)
		}
		moved, err = job.MoveToWaitingChildren(ctx, keys)
		if !errors.Is(err, bullmq.ErrJobLockNotExist) || moved {
			t.Errorf("missing lock: moved = %v, err = %v; want ErrJobLockNotExist", moved, err)
		}
		if state, err := job.State(ctx); err != nil || state != bullmq.StateActive {
			t.Errorf("state after missing lock = %q (%v), want active", state, err)
		}

		// Restore the lock so the worker can complete the job normally.
		if err := parentQ.Client().Set(ctx, lockKey, job.Token(), 30*time.Second).Err(); err != nil {
			t.Errorf("Set lock: %v", err)
		}
		return nil
	})
}

func TestMoveToWaitingChildrenWithoutATokenFails(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	parentQ := newTestQueue(t, nil)
	childQ := newChildQueue(t)

	parent, err := parentQ.Add(ctx, "parent", nil, nil)
	if err != nil {
		t.Fatalf("Add parent: %v", err)
	}
	child := addChild(t, ctx, childQ, parentQ, parent, "child")

	// A job fetched through the queue is not being processed, so it has no token.
	stored, err := parentQ.Job(ctx, parent.ID)
	if err != nil {
		t.Fatalf("Job: %v", err)
	}
	moved, err := stored.MoveToWaitingChildren(ctx, childKeys(childQ, child))
	if err == nil || moved {
		t.Fatalf("moved = %v, err = %v; want an error", moved, err)
	}
	requireState(t, ctx, parentQ, parent.ID, bullmq.StateWaiting)
}

func TestCompletingTheLastChildReleasesTheParkedParent(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	parentQ := newTestQueue(t, nil)
	childQ := newChildQueue(t)

	parent, err := parentQ.Add(ctx, "parent", nil, nil)
	if err != nil {
		t.Fatalf("Add parent: %v", err)
	}
	first := addChild(t, ctx, childQ, parentQ, parent, "first")
	second := addChild(t, ctx, childQ, parentQ, parent, "second")

	var runs atomic.Int32
	parked := make(chan struct{})
	finished := make(chan bool, 1)
	pw := newTestWorker(t, parentQ.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		if runs.Add(1) == 1 {
			moved, err := job.MoveToWaitingChildren(ctx, nil)
			if err != nil || !moved {
				t.Errorf("first run: moved = %v, err = %v; want true, nil", moved, err)
			}
			close(parked)
			return nil, bullmq.ErrWaitingChildren
		}
		moved, err := job.MoveToWaitingChildren(ctx, nil)
		finished <- moved
		if err != nil {
			t.Errorf("second run: %v", err)
		}
		return "done", nil
	}, nil)
	runWorker(t, pw)

	select {
	case <-parked:
	case <-time.After(15 * time.Second):
		t.Fatal("parent was not parked in time")
	}
	waitFor(t, 5*time.Second, "parent to be waiting for children", func() bool {
		s, _ := parentQ.JobState(ctx, parent.ID)
		return s == bullmq.StateWaitingChildren
	})

	release := map[string]chan struct{}{
		first.ID:  make(chan struct{}),
		second.ID: make(chan struct{}),
	}
	cw := newTestWorker(t, childQ.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		select {
		case <-release[job.ID]:
			return nil, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}, nil)
	runWorker(t, cw)

	// Completing the first child must leave the parent parked.
	close(release[first.ID])
	waitFor(t, 10*time.Second, "first child to complete", func() bool {
		s, _ := childQ.JobState(ctx, first.ID)
		return s == bullmq.StateCompleted
	})
	requireState(t, ctx, parentQ, parent.ID, bullmq.StateWaitingChildren)
	if n, err := parentQ.Client().SCard(ctx, parentQ.Keys().Dependencies(parent.ID)).Result(); err != nil || n != 1 {
		t.Fatalf("pending dependencies = %d (%v), want 1", n, err)
	}
	if got := runs.Load(); got != 1 {
		t.Fatalf("parent ran %d times while a child was pending, want 1", got)
	}

	// Completing the last child releases it.
	close(release[second.ID])
	select {
	case moved := <-finished:
		if moved {
			t.Fatal("MoveToWaitingChildren = true after all children completed, want false")
		}
	case <-time.After(15 * time.Second):
		t.Fatal("parent was not released after its last child completed")
	}
	waitFor(t, 10*time.Second, "parent to complete", func() bool {
		s, _ := parentQ.JobState(ctx, parent.ID)
		return s == bullmq.StateCompleted
	})
	if n, err := parentQ.Client().SCard(ctx, parentQ.Keys().Dependencies(parent.ID)).Result(); err != nil || n != 0 {
		t.Fatalf("pending dependencies = %d (%v), want 0", n, err)
	}
}

func TestAddedChildJobReportsItsParent(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	parentQ := newTestQueue(t, nil)
	childQ := newChildQueue(t)

	parent, err := parentQ.Add(ctx, "parent", nil, nil)
	if err != nil {
		t.Fatalf("Add parent: %v", err)
	}
	qualified := parentQ.Backend().QualifiedName()
	wantKey := qualified + ":" + parent.ID

	check := func(t *testing.T, label string, job *bullmq.Job) {
		t.Helper()
		if job.ParentKey != wantKey {
			t.Errorf("%s: ParentKey = %q, want %q", label, job.ParentKey, wantKey)
		}
		if job.Parent == nil || job.Parent.ID != parent.ID || job.Parent.QueueKey != qualified {
			t.Errorf("%s: Parent = %+v, want {%s %s}", label, job.Parent, parent.ID, qualified)
		}
		stored, err := childQ.Job(ctx, job.ID)
		if err != nil || stored == nil {
			t.Fatalf("%s: Job: %v", label, err)
		}
		if stored.ParentKey != job.ParentKey || stored.Parent == nil || *stored.Parent != *job.Parent {
			t.Errorf("%s: returned job (%q, %+v) differs from fetched job (%q, %+v)",
				label, job.ParentKey, job.Parent, stored.ParentKey, stored.Parent)
		}
	}

	// A bare queue name and a fully qualified one resolve identically.
	bare, err := childQ.Add(ctx, "bare", nil, &bullmq.JobOptions{
		Parent: &bullmq.ParentOptions{ID: parent.ID, Queue: parentQ.Name()},
	})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	check(t, "Add bare queue", bare)

	full := addChild(t, ctx, childQ, parentQ, parent, "full")
	check(t, "Add qualified queue", full)

	bulk, err := childQ.AddBulk(ctx, []bullmq.JobSpec{
		{Name: "b1", Opts: &bullmq.JobOptions{Parent: &bullmq.ParentOptions{ID: parent.ID, Queue: qualified}}},
		{Name: "orphan"},
	})
	if err != nil {
		t.Fatalf("AddBulk: %v", err)
	}
	check(t, "AddBulk", bulk[0])
	if bulk[1].Parent != nil || bulk[1].ParentKey != "" {
		t.Errorf("job without a parent: Parent = %+v, ParentKey = %q; want zero values", bulk[1].Parent, bulk[1].ParentKey)
	}
}
