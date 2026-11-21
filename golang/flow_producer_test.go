package bullmq_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

func newTestFlowProducer(t *testing.T, be testBackend) *bullmq.FlowProducer {
	t.Helper()
	fp, err := bullmq.NewFlowProducer(&bullmq.FlowProducerOptions{Backend: be.Factory})
	if err != nil {
		t.Fatalf("NewFlowProducer: %v", err)
	}
	t.Cleanup(func() { _ = fp.Close() })
	return fp
}

// newSuffixedQueue creates another queue for the running test, obliterated
// when it ends.
func newSuffixedQueue(t *testing.T, be testBackend, suffix string) *bullmq.Queue {
	t.Helper()
	q, err := bullmq.NewQueue(testQueueName(t)+"-"+suffix, &bullmq.QueueOptions{Backend: be.Factory})
	if err != nil {
		t.Fatalf("NewQueue: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = q.Obliterate(ctx, &bullmq.ObliterateOptions{Force: true})
		_ = q.Close()
	})
	return q
}

// jobKey is the key identifying a job of q among the children of its parent.
func jobKey(q *bullmq.Queue, id string) string {
	return q.Backend().QualifiedName() + ":" + id
}

func waitForState(t *testing.T, q *bullmq.Queue, id string, want bullmq.JobState) {
	t.Helper()
	waitFor(t, 15*time.Second, fmt.Sprintf("job %s to be %s", id, want), func() bool {
		state, _ := q.JobState(context.Background(), id)
		return state == want
	})
}

func requireCounts(t *testing.T, ctx context.Context, job *bullmq.Job, want bullmq.DependencyCounts) {
	t.Helper()
	got, err := job.DependenciesCount(ctx)
	if err != nil {
		t.Fatalf("DependenciesCount: %v", err)
	}
	if got != want {
		t.Fatalf("DependenciesCount = %+v, want %+v", got, want)
	}
}

// failingProcessor fails the jobs named "fail" with "boom" and returns the
// name of the others.
func failingProcessor(_ context.Context, job *bullmq.Job) (any, error) {
	if job.Name == "fail" {
		return nil, errors.New("boom")
	}
	return job.Name, nil
}

func TestFlowProducerProcessesChildrenBeforeParent(t *testing.T) {
	forEachBackend(t, testFlowProducerProcessesChildrenBeforeParent)
}

func testFlowProducerProcessesChildrenBeforeParent(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	fp := newTestFlowProducer(t, be)

	tree, err := fp.Add(ctx, bullmq.FlowJob{
		Name: "parent", QueueName: q.Name(), Data: map[string]string{"kind": "parent"},
		Children: []bullmq.FlowJob{
			{Name: "child", QueueName: q.Name(), Data: map[string]int{"n": 1}},
			{Name: "child", QueueName: q.Name(), Data: map[string]int{"n": 2}},
		},
	}, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	parent := tree.Job
	if len(tree.Children) != 2 {
		t.Fatalf("children = %d, want 2", len(tree.Children))
	}
	for _, c := range tree.Children {
		child := c.Job
		if child.Parent == nil || child.Parent.ID != parent.ID || child.ParentKey != jobKey(q, parent.ID) {
			t.Fatalf("child parent = %+v / %q", child.Parent, child.ParentKey)
		}
		stored, err := q.Job(ctx, child.ID)
		if err != nil || stored == nil || stored.ParentKey != child.ParentKey {
			t.Fatalf("stored child = %+v (%v)", stored, err)
		}
		requireState(t, ctx, q, child.ID, bullmq.StateWaiting)
	}
	requireState(t, ctx, q, parent.ID, bullmq.StateWaitingChildren)
	requireCounts(t, ctx, parent, bullmq.DependencyCounts{Unprocessed: 2})

	var childrenDone atomic.Int32
	values := make(chan map[string]json.RawMessage, 1)
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		if job.Name == "child" {
			var d struct{ N int }
			if err := job.DecodeData(&d); err != nil {
				return nil, err
			}
			childrenDone.Add(1)
			return d.N * 10, nil
		}
		if n := childrenDone.Load(); n != 2 {
			t.Errorf("parent processed after %d children, want 2", n)
		}
		v, err := job.ChildrenValues(ctx)
		if err != nil {
			t.Errorf("ChildrenValues: %v", err)
		}
		values <- v
		return "done", nil
	}, nil)
	runWorker(t, w)

	select {
	case v := <-values:
		want := map[string]string{
			jobKey(q, tree.Children[0].Job.ID): "10",
			jobKey(q, tree.Children[1].Job.ID): "20",
		}
		if len(v) != len(want) {
			t.Fatalf("children values = %s, want %v", v, want)
		}
		for k, raw := range want {
			if string(v[k]) != raw {
				t.Fatalf("children values = %s, want %v", v, want)
			}
		}
	case <-time.After(15 * time.Second):
		t.Fatal("parent was not processed")
	}
	waitForState(t, q, parent.ID, bullmq.StateCompleted)
	requireCounts(t, ctx, parent, bullmq.DependencyCounts{Processed: 2})
}

func TestFlowProducerProcessesMultiLevelFlowsBottomUp(t *testing.T) {
	forEachBackend(t, testFlowProducerProcessesMultiLevelFlowsBottomUp)
}

func testFlowProducerProcessesMultiLevelFlowsBottomUp(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	fp := newTestFlowProducer(t, be)

	tree, err := fp.Add(ctx, bullmq.FlowJob{
		Name: "root", QueueName: q.Name(),
		Children: []bullmq.FlowJob{
			{Name: "mid", QueueName: q.Name(), Children: []bullmq.FlowJob{
				{Name: "leaf-1", QueueName: q.Name()},
				{Name: "leaf-2", QueueName: q.Name()},
			}},
			{Name: "leaf-3", QueueName: q.Name()},
		},
	}, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	mid := tree.Children[0].Job
	requireState(t, ctx, q, tree.Job.ID, bullmq.StateWaitingChildren)
	requireState(t, ctx, q, mid.ID, bullmq.StateWaitingChildren)

	var mu sync.Mutex
	var order []string
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		mu.Lock()
		order = append(order, job.Name)
		mu.Unlock()
		values, err := job.ChildrenValues(ctx)
		if err != nil {
			return nil, err
		}
		names := make([]string, 0, len(values))
		for _, raw := range values {
			var v struct{ Name string }
			if err := json.Unmarshal(raw, &v); err != nil {
				return nil, err
			}
			names = append(names, v.Name)
		}
		slices.Sort(names)
		return map[string]any{"name": job.Name, "children": names}, nil
	}, &bullmq.WorkerOptions{Concurrency: 3})
	runWorker(t, w)

	waitForState(t, q, tree.Job.ID, bullmq.StateCompleted)
	mu.Lock()
	defer mu.Unlock()
	pos := func(name string) int { return slices.Index(order, name) }
	if pos("mid") < pos("leaf-1") || pos("mid") < pos("leaf-2") || pos("root") != len(order)-1 || len(order) != 5 {
		t.Fatalf("processing order = %v, want leaves before mid before root", order)
	}
	root, err := q.Job(ctx, tree.Job.ID)
	if err != nil || root == nil {
		t.Fatalf("Job: %v", err)
	}
	var result struct{ Children []string }
	if err := root.DecodeReturnValue(&result); err != nil {
		t.Fatalf("DecodeReturnValue: %v", err)
	}
	if !slices.Equal(result.Children, []string{"leaf-3", "mid"}) {
		t.Fatalf("root saw children %v, want [leaf-3 mid]", result.Children)
	}
}

func TestFlowProducerAddsCrossQueueFlows(t *testing.T) {
	forEachBackend(t, testFlowProducerAddsCrossQueueFlows)
}

func testFlowProducerAddsCrossQueueFlows(t *testing.T, be testBackend) {
	ctx := testContext(t)
	parentQ := newTestQueue(t, be, nil)
	childQ := newSuffixedQueue(t, be, "b")
	grandchildQ := newSuffixedQueue(t, be, "c")
	fp := newTestFlowProducer(t, be)

	tree, err := fp.Add(ctx, bullmq.FlowJob{
		Name: "parent", QueueName: parentQ.Name(),
		Children: []bullmq.FlowJob{
			{Name: "child", QueueName: childQ.Name(), Children: []bullmq.FlowJob{
				{Name: "grandchild", QueueName: grandchildQ.Name(), Data: 3},
			}},
		},
	}, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	child := tree.Children[0].Job
	grandchild := tree.Children[0].Children[0].Job
	if child.QueueName != childQ.Name() || grandchild.QueueName != grandchildQ.Name() {
		t.Fatalf("queues = %q, %q", child.QueueName, grandchild.QueueName)
	}
	if child.Parent == nil || child.Parent.QueueKey != parentQ.Backend().QualifiedName() ||
		grandchild.Parent == nil || grandchild.Parent.QueueKey != childQ.Backend().QualifiedName() {
		t.Fatalf("parents = %+v, %+v", child.Parent, grandchild.Parent)
	}
	requireState(t, ctx, childQ, child.ID, bullmq.StateWaitingChildren)
	requireState(t, ctx, grandchildQ, grandchild.ID, bullmq.StateWaiting)
	deps, err := child.Dependencies(ctx, nil)
	if err != nil || !slices.Equal(deps.Unprocessed, []string{jobKey(grandchildQ, grandchild.ID)}) {
		t.Fatalf("child dependencies = %+v (%v)", deps, err)
	}

	sum := func(ctx context.Context, job *bullmq.Job) (any, error) {
		values, err := job.ChildrenValues(ctx)
		if err != nil {
			return nil, err
		}
		total := 0
		for _, raw := range values {
			var n int
			if err := json.Unmarshal(raw, &n); err != nil {
				return nil, err
			}
			total += n
		}
		if len(job.Data) > 0 && string(job.Data) != "null" {
			var n int
			if err := job.DecodeData(&n); err == nil {
				total += n
			}
		}
		return total + 1, nil
	}
	for _, q := range []*bullmq.Queue{parentQ, childQ, grandchildQ} {
		runWorker(t, newTestWorker(t, be, q.Name(), sum, nil))
	}
	waitForState(t, parentQ, tree.Job.ID, bullmq.StateCompleted)

	parent, err := parentQ.Job(ctx, tree.Job.ID)
	if err != nil || parent == nil {
		t.Fatalf("Job: %v", err)
	}
	if string(parent.ReturnValue) != "6" {
		t.Fatalf("parent return value = %s, want 6", parent.ReturnValue)
	}
	values, err := parent.ChildrenValues(ctx)
	if err != nil || string(values[jobKey(childQ, child.ID)]) != "5" || len(values) != 1 {
		t.Fatalf("parent children values = %s (%v)", values, err)
	}
}

func TestFlowFailParentOnFailure(t *testing.T) {
	forEachBackend(t, testFlowFailParentOnFailure)
}

func testFlowFailParentOnFailure(t *testing.T, be testBackend) {
	ctx := testContext(t)
	parentQ := newTestQueue(t, be, nil)
	childQ := newSuffixedQueue(t, be, "children")
	idleQ := newSuffixedQueue(t, be, "idle")
	fp := newTestFlowProducer(t, be)

	tree, err := fp.Add(ctx, bullmq.FlowJob{
		Name: "parent", QueueName: parentQ.Name(),
		Children: []bullmq.FlowJob{
			{Name: "fail", QueueName: childQ.Name(), Opts: &bullmq.JobOptions{FailParentOnFailure: bullmq.Bool(true)}},
			{Name: "pending", QueueName: idleQ.Name()},
		},
	}, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	failing := tree.Children[0].Job

	var parentRuns atomic.Int32
	runWorker(t, newTestWorker(t, be, parentQ.Name(), func(context.Context, *bullmq.Job) (any, error) {
		parentRuns.Add(1)
		return nil, nil
	}, nil))
	runWorker(t, newTestWorker(t, be, childQ.Name(), failingProcessor, nil))

	waitForState(t, parentQ, tree.Job.ID, bullmq.StateFailed)
	parent, err := parentQ.Job(ctx, tree.Job.ID)
	if err != nil || parent == nil {
		t.Fatalf("Job: %v", err)
	}
	if want := "child " + jobKey(childQ, failing.ID) + " failed"; parent.FailedReason != want {
		t.Fatalf("parent failed reason = %q, want %q", parent.FailedReason, want)
	}
	if n := parentRuns.Load(); n != 0 {
		t.Fatalf("parent processor ran %d times, want 0", n)
	}
	requireCounts(t, ctx, parent, bullmq.DependencyCounts{Unprocessed: 1, Failed: 1})
	deps, err := parent.Dependencies(ctx, nil)
	if err != nil || !slices.Equal(deps.Failed, []string{jobKey(childQ, failing.ID)}) {
		t.Fatalf("dependencies = %+v (%v)", deps, err)
	}
}

func TestFlowContinueParentOnFailure(t *testing.T) {
	forEachBackend(t, testFlowContinueParentOnFailure)
}

func testFlowContinueParentOnFailure(t *testing.T, be testBackend) {
	ctx := testContext(t)
	parentQ := newTestQueue(t, be, nil)
	childQ := newSuffixedQueue(t, be, "children")
	idleQ := newSuffixedQueue(t, be, "idle")
	fp := newTestFlowProducer(t, be)

	tree, err := fp.Add(ctx, bullmq.FlowJob{
		Name: "parent", QueueName: parentQ.Name(),
		Children: []bullmq.FlowJob{
			{Name: "fail", QueueName: childQ.Name(), Opts: &bullmq.JobOptions{ContinueParentOnFailure: bullmq.Bool(true)}},
			{Name: "pending", QueueName: idleQ.Name()},
		},
	}, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	failingKey := jobKey(childQ, tree.Children[0].Job.ID)

	type seen struct {
		ignored, deprecated map[string]string
		counts              bullmq.DependencyCounts
	}
	got := make(chan seen, 1)
	runWorker(t, newTestWorker(t, be, parentQ.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		var s seen
		var err error
		if s.ignored, err = job.IgnoredChildrenFailures(ctx); err != nil {
			return nil, err
		}
		if s.deprecated, err = job.FailedChildrenValues(ctx); err != nil { //nolint:staticcheck // the deprecated alias must keep working
			return nil, err
		}
		if s.counts, err = job.DependenciesCount(ctx); err != nil {
			return nil, err
		}
		select {
		case got <- s:
		default:
		}
		return nil, nil
	}, nil))
	runWorker(t, newTestWorker(t, be, childQ.Name(), failingProcessor, nil))

	// The parent starts as soon as the child fails, although another child
	// is still pending.
	select {
	case s := <-got:
		want := map[string]string{failingKey: "boom"}
		if fmt.Sprint(s.ignored) != fmt.Sprint(want) || fmt.Sprint(s.deprecated) != fmt.Sprint(want) {
			t.Fatalf("ignored failures = %v / %v, want %v", s.ignored, s.deprecated, want)
		}
		if s.counts != (bullmq.DependencyCounts{Unprocessed: 1, Ignored: 1}) {
			t.Fatalf("counts = %+v", s.counts)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("parent was not processed after its child failed")
	}
	// It cannot complete while that child is pending: as in Node, it fails.
	waitForState(t, parentQ, tree.Job.ID, bullmq.StateFailed)
	parent, err := parentQ.Job(ctx, tree.Job.ID)
	if err != nil || parent == nil {
		t.Fatalf("Job: %v", err)
	}
	if want := "Job " + parent.ID + " has pending dependencies. moveToFinished"; parent.FailedReason != want {
		t.Fatalf("parent failed reason = %q, want %q", parent.FailedReason, want)
	}
}

func TestFlowIgnoreAndRemoveDependencyOnFailure(t *testing.T) {
	forEachBackend(t, testFlowIgnoreAndRemoveDependencyOnFailure)
}

func testFlowIgnoreAndRemoveDependencyOnFailure(t *testing.T, be testBackend) {
	for _, c := range []struct {
		name        string
		opts        *bullmq.JobOptions
		wantIgnored bool
	}{
		{"ignore", &bullmq.JobOptions{IgnoreDependencyOnFailure: bullmq.Bool(true)}, true},
		{"remove", &bullmq.JobOptions{RemoveDependencyOnFailure: bullmq.Bool(true)}, false},
	} {
		t.Run(c.name, func(t *testing.T) {
			ctx := testContext(t)
			parentQ := newTestQueue(t, be, nil)
			childQ := newSuffixedQueue(t, be, "children")
			fp := newTestFlowProducer(t, be)

			release := make(chan struct{})
			tree, err := fp.Add(ctx, bullmq.FlowJob{
				Name: "parent", QueueName: parentQ.Name(),
				Children: []bullmq.FlowJob{
					{Name: "fail", QueueName: childQ.Name(), Opts: c.opts},
					{Name: "ok", QueueName: childQ.Name()},
				},
			}, nil)
			if err != nil {
				t.Fatalf("Add: %v", err)
			}
			failingKey := jobKey(childQ, tree.Children[0].Job.ID)
			okKey := jobKey(childQ, tree.Children[1].Job.ID)

			parentDone := make(chan error, 1)
			runWorker(t, newTestWorker(t, be, parentQ.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
				parentDone <- func() error {
					ignored, err := job.IgnoredChildrenFailures(ctx)
					if err != nil {
						return err
					}
					wantIgnored := map[string]string{}
					if c.wantIgnored {
						wantIgnored[failingKey] = "boom"
					}
					if fmt.Sprint(ignored) != fmt.Sprint(wantIgnored) {
						return fmt.Errorf("ignored failures = %v, want %v", ignored, wantIgnored)
					}
					values, err := job.ChildrenValues(ctx)
					if err != nil {
						return err
					}
					if len(values) != 1 || string(values[okKey]) != `"ok"` {
						return fmt.Errorf("children values = %s", values)
					}
					return nil
				}()
				return nil, nil
			}, nil))
			runWorker(t, newTestWorker(t, be, childQ.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
				if job.Name == "ok" {
					// The parent waits for the remaining child.
					select {
					case <-release:
					case <-ctx.Done():
						return nil, ctx.Err()
					}
				}
				return failingProcessor(ctx, job)
			}, &bullmq.WorkerOptions{Concurrency: 2}))

			waitForState(t, childQ, tree.Children[0].Job.ID, bullmq.StateFailed)
			requireState(t, ctx, parentQ, tree.Job.ID, bullmq.StateWaitingChildren)
			wantCounts := bullmq.DependencyCounts{Unprocessed: 1}
			if c.wantIgnored {
				wantCounts.Ignored = 1
			}
			requireCounts(t, ctx, tree.Job, wantCounts)
			close(release)

			select {
			case err := <-parentDone:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(15 * time.Second):
				t.Fatal("parent was not processed")
			}
			waitForState(t, parentQ, tree.Job.ID, bullmq.StateCompleted)
		})
	}
}

func TestJobDependenciesCountsAndPagination(t *testing.T) {
	forEachBackend(t, testJobDependenciesCountsAndPagination)
}

func testJobDependenciesCountsAndPagination(t *testing.T, be testBackend) {
	ctx := testContext(t)
	parentQ := newTestQueue(t, be, nil)
	childQ := newSuffixedQueue(t, be, "children")
	idleQ := newSuffixedQueue(t, be, "idle")
	fp := newTestFlowProducer(t, be)

	var children []bullmq.FlowJob
	add := func(n int, name string, q *bullmq.Queue, opts func() *bullmq.JobOptions) {
		for i := 0; i < n; i++ {
			children = append(children, bullmq.FlowJob{Name: name, QueueName: q.Name(), Data: i, Opts: opts()})
		}
	}
	none := func() *bullmq.JobOptions { return nil }
	add(7, "ok", childQ, none)
	add(4, "fail", childQ, func() *bullmq.JobOptions {
		return &bullmq.JobOptions{IgnoreDependencyOnFailure: bullmq.Bool(true)}
	})
	add(5, "fail", childQ, func() *bullmq.JobOptions {
		return &bullmq.JobOptions{FailParentOnFailure: bullmq.Bool(true)}
	})
	add(6, "pending", idleQ, none)
	tree, err := fp.Add(ctx, bullmq.FlowJob{Name: "parent", QueueName: parentQ.Name(), Children: children}, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	parent := tree.Job

	keys := func(from, to int) []string {
		var out []string
		for _, c := range tree.Children[from:to] {
			out = append(out, jobKey(map[string]*bullmq.Queue{childQ.Name(): childQ, idleQ.Name(): idleQ}[c.Job.QueueName], c.Job.ID))
		}
		slices.Sort(out)
		return out
	}
	all, err := parent.Dependencies(ctx, nil)
	if err != nil {
		t.Fatalf("Dependencies: %v", err)
	}
	if got := slices.Sorted(slices.Values(all.Unprocessed)); !slices.Equal(got, keys(0, 22)) {
		t.Fatalf("unprocessed = %v", got)
	}
	if len(all.Processed) != 0 || len(all.Ignored) != 0 || len(all.Failed) != 0 {
		t.Fatalf("dependencies = %+v, want only unprocessed children", all)
	}
	requireCounts(t, ctx, parent, bullmq.DependencyCounts{Unprocessed: 22})

	runWorker(t, newTestWorker(t, be, childQ.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
		if job.Name == "fail" {
			return nil, errors.New("boom " + string(job.Data))
		}
		return job.Data, nil
	}, &bullmq.WorkerOptions{Concurrency: 4}))
	waitFor(t, 15*time.Second, "children to finish", func() bool {
		c, err := parent.DependenciesCount(ctx)
		return err == nil && c.Unprocessed == 6
	})
	requireCounts(t, ctx, parent, bullmq.DependencyCounts{Processed: 7, Ignored: 4, Failed: 5, Unprocessed: 6})

	all, err = parent.Dependencies(ctx, nil)
	if err != nil {
		t.Fatalf("Dependencies: %v", err)
	}
	if got := slices.Sorted(maps.Keys(all.Processed)); !slices.Equal(got, keys(0, 7)) {
		t.Fatalf("processed = %v", got)
	}
	for i, c := range tree.Children[:7] {
		if raw := all.Processed[jobKey(childQ, c.Job.ID)]; string(raw) != fmt.Sprint(i) {
			t.Fatalf("processed value of child %d = %s", i, raw)
		}
	}
	if got := slices.Sorted(maps.Keys(all.Ignored)); !slices.Equal(got, keys(7, 11)) {
		t.Fatalf("ignored = %v", got)
	}
	for i, c := range tree.Children[7:11] {
		if reason := all.Ignored[jobKey(childQ, c.Job.ID)]; reason != fmt.Sprintf("boom %d", i) {
			t.Fatalf("ignored reason of child %d = %q", i, reason)
		}
	}
	if got := slices.Sorted(slices.Values(all.Failed)); !slices.Equal(got, keys(11, 16)) {
		t.Fatalf("failed = %v", got)
	}
	if got := slices.Sorted(slices.Values(all.Unprocessed)); !slices.Equal(got, keys(16, 22)) {
		t.Fatalf("unprocessed = %v", got)
	}

	// Paging through every group yields each child once.
	type group struct {
		name string
		set  func(*bullmq.DependenciesOptions, *bullmq.DependencyPage)
		read func(*bullmq.Dependencies) ([]string, uint64)
		want []string
	}
	groups := []group{
		{"processed", func(o *bullmq.DependenciesOptions, p *bullmq.DependencyPage) { o.Processed = p },
			func(d *bullmq.Dependencies) ([]string, uint64) {
				return slices.Collect(maps.Keys(d.Processed)), d.NextProcessedCursor
			}, keys(0, 7)},
		{"ignored", func(o *bullmq.DependenciesOptions, p *bullmq.DependencyPage) { o.Ignored = p },
			func(d *bullmq.Dependencies) ([]string, uint64) {
				return slices.Collect(maps.Keys(d.Ignored)), d.NextIgnoredCursor
			}, keys(7, 11)},
		{"failed", func(o *bullmq.DependenciesOptions, p *bullmq.DependencyPage) { o.Failed = p },
			func(d *bullmq.Dependencies) ([]string, uint64) { return d.Failed, d.NextFailedCursor }, keys(11, 16)},
		{"unprocessed", func(o *bullmq.DependenciesOptions, p *bullmq.DependencyPage) { o.Unprocessed = p },
			func(d *bullmq.Dependencies) ([]string, uint64) { return d.Unprocessed, d.NextUnprocessedCursor }, keys(16, 22)},
	}
	for _, g := range groups {
		var collected []string
		var cursor uint64
		for pages := 0; ; pages++ {
			if pages > 20 {
				t.Fatalf("%s: pagination does not end", g.name)
			}
			var opts bullmq.DependenciesOptions
			g.set(&opts, &bullmq.DependencyPage{Cursor: cursor, Count: 2})
			deps, err := parent.Dependencies(ctx, &opts)
			if err != nil {
				t.Fatalf("%s: Dependencies: %v", g.name, err)
			}
			// Only the requested group is returned.
			returned := 0
			for _, present := range []bool{deps.Processed != nil, deps.Unprocessed != nil, deps.Ignored != nil, deps.Failed != nil} {
				if present {
					returned++
				}
			}
			if returned != 1 {
				t.Fatalf("%s: %d groups returned, want 1: %+v", g.name, returned, deps)
			}
			page, next := g.read(deps)
			if g.name == "failed" && len(page) > 2 {
				t.Fatalf("failed page has %d children, want at most 2", len(page))
			}
			collected = append(collected, page...)
			if next == 0 {
				break
			}
			cursor = next
		}
		slices.Sort(collected)
		if !slices.Equal(collected, g.want) {
			t.Fatalf("%s: paged children = %v, want %v", g.name, collected, g.want)
		}
	}
}

func TestJobRemoveChildDependency(t *testing.T) {
	forEachBackend(t, testJobRemoveChildDependency)
}

func testJobRemoveChildDependency(t *testing.T, be testBackend) {
	ctx := testContext(t)
	parentQ := newTestQueue(t, be, nil)
	childQ := newSuffixedQueue(t, be, "children")
	fp := newTestFlowProducer(t, be)

	tree, err := fp.Add(ctx, bullmq.FlowJob{
		Name: "parent", QueueName: parentQ.Name(),
		Children: []bullmq.FlowJob{
			{Name: "first", QueueName: childQ.Name()},
			{Name: "second", QueueName: childQ.Name()},
		},
	}, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	first, second := tree.Children[0].Job, tree.Children[1].Job

	removed, err := first.RemoveChildDependency(ctx)
	if err != nil || !removed {
		t.Fatalf("RemoveChildDependency = %v, %v; want true", removed, err)
	}
	if first.Parent != nil || first.ParentKey != "" {
		t.Fatalf("parent after removal = %+v / %q, want none", first.Parent, first.ParentKey)
	}
	stored, err := childQ.Job(ctx, first.ID)
	if err != nil || stored == nil || stored.Parent != nil || stored.ParentKey != "" {
		t.Fatalf("stored child = %+v (%v), want no parent", stored, err)
	}
	requireState(t, ctx, parentQ, tree.Job.ID, bullmq.StateWaitingChildren)
	requireCounts(t, ctx, tree.Job, bullmq.DependencyCounts{Unprocessed: 1})

	// The child no longer has a parent: as in Node.js, that is an error.
	for _, job := range []*bullmq.Job{stored, first} {
		if removed, err := job.RemoveChildDependency(ctx); !errors.Is(err, bullmq.ErrParentJobNotExist) || removed {
			t.Fatalf("RemoveChildDependency without a parent = %v, %v; want ErrParentJobNotExist", removed, err)
		}
	}
	plain, err := childQ.Add(ctx, "plain", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if _, err := plain.RemoveChildDependency(ctx); !errors.Is(err, bullmq.ErrParentJobNotExist) {
		t.Fatalf("RemoveChildDependency of a job without a parent = %v, want ErrParentJobNotExist", err)
	}

	// Removing the last pending child releases the parent.
	if removed, err := second.RemoveChildDependency(ctx); err != nil || !removed {
		t.Fatalf("RemoveChildDependency(last) = %v, %v; want true", removed, err)
	}
	requireState(t, ctx, parentQ, tree.Job.ID, bullmq.StateWaiting)

	// A child whose parent no longer exists.
	orphanTree, err := fp.Add(ctx, bullmq.FlowJob{
		Name: "parent", QueueName: parentQ.Name(),
		Children: []bullmq.FlowJob{{Name: "orphan", QueueName: childQ.Name()}},
	}, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := orphanTree.Job.Remove(ctx, false); err != nil {
		t.Fatalf("Remove parent: %v", err)
	}
	if _, err := orphanTree.Children[0].Job.RemoveChildDependency(ctx); !errors.Is(err, bullmq.ErrParentJobNotExist) {
		t.Fatalf("RemoveChildDependency with a missing parent: %v, want ErrParentJobNotExist", err)
	}
}

func TestJobRemoveUnprocessedChildren(t *testing.T) {
	forEachBackend(t, testJobRemoveUnprocessedChildren)
}

func testJobRemoveUnprocessedChildren(t *testing.T, be testBackend) {
	ctx := testContext(t)
	parentQ := newTestQueue(t, be, nil)
	doneQ := newSuffixedQueue(t, be, "done")
	idleQ := newSuffixedQueue(t, be, "idle")
	fp := newTestFlowProducer(t, be)

	tree, err := fp.Add(ctx, bullmq.FlowJob{
		Name: "parent", QueueName: parentQ.Name(),
		Children: []bullmq.FlowJob{
			{Name: "done", QueueName: doneQ.Name()},
			{Name: "idle", QueueName: idleQ.Name()},
			{Name: "idle-parent", QueueName: idleQ.Name(), Children: []bullmq.FlowJob{
				{Name: "idle-grandchild", QueueName: idleQ.Name()},
			}},
		},
	}, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	done := tree.Children[0].Job
	runWorker(t, newTestWorker(t, be, doneQ.Name(), failingProcessor, nil))
	waitForState(t, doneQ, done.ID, bullmq.StateCompleted)

	if err := tree.Job.RemoveUnprocessedChildren(ctx); err != nil {
		t.Fatalf("RemoveUnprocessedChildren: %v", err)
	}
	for _, c := range []*bullmq.Job{tree.Children[1].Job, tree.Children[2].Job, tree.Children[2].Children[0].Job} {
		if job, err := idleQ.Job(ctx, c.ID); err != nil || job != nil {
			t.Fatalf("%s still exists (%v)", c.Name, err)
		}
	}
	if job, err := doneQ.Job(ctx, done.ID); err != nil || job == nil {
		t.Fatalf("the processed child was removed (%v)", err)
	}
	if job, err := parentQ.Job(ctx, tree.Job.ID); err != nil || job == nil {
		t.Fatalf("the parent was removed (%v)", err)
	}
	// The pending dependencies left behind differ: Redis drops them (and
	// releases the parent), the shared SQL keeps them, so only the processed
	// child is checked, as in Node's tests.
	counts, err := tree.Job.DependenciesCount(ctx)
	if err != nil || counts.Processed != 1 {
		t.Fatalf("counts = %+v (%v)", counts, err)
	}
}

func TestFlowProducerAddBulk(t *testing.T) {
	forEachBackend(t, testFlowProducerAddBulk)
}

func testFlowProducerAddBulk(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	otherQ := newSuffixedQueue(t, be, "other")
	fp := newTestFlowProducer(t, be)

	trees, err := fp.AddBulk(ctx, []bullmq.FlowJob{
		{Name: "parent-1", QueueName: q.Name(), Children: []bullmq.FlowJob{
			{Name: "child", QueueName: otherQ.Name(), Data: 1},
		}},
		{Name: "parent-2", QueueName: otherQ.Name(), Children: []bullmq.FlowJob{
			{Name: "child", QueueName: q.Name(), Data: 2},
			{Name: "child", QueueName: q.Name(), Data: 3},
		}},
		{Name: "single", QueueName: q.Name()},
	})
	if err != nil {
		t.Fatalf("AddBulk: %v", err)
	}
	if len(trees) != 3 || len(trees[0].Children) != 1 || len(trees[1].Children) != 2 || trees[2].Children != nil {
		t.Fatalf("trees = %+v", trees)
	}
	requireState(t, ctx, q, trees[0].Job.ID, bullmq.StateWaitingChildren)
	requireState(t, ctx, otherQ, trees[1].Job.ID, bullmq.StateWaitingChildren)
	requireState(t, ctx, q, trees[2].Job.ID, bullmq.StateWaiting)

	proc := func(ctx context.Context, job *bullmq.Job) (any, error) {
		if !strings.HasPrefix(job.Name, "parent") {
			return job.Data, nil
		}
		values, err := job.ChildrenValues(ctx)
		if err != nil {
			return nil, err
		}
		return len(values), nil
	}
	runWorker(t, newTestWorker(t, be, q.Name(), proc, nil))
	runWorker(t, newTestWorker(t, be, otherQ.Name(), proc, nil))
	waitForState(t, q, trees[0].Job.ID, bullmq.StateCompleted)
	waitForState(t, otherQ, trees[1].Job.ID, bullmq.StateCompleted)
	for i, want := range map[int]string{0: "1", 1: "2"} {
		qq := []*bullmq.Queue{q, otherQ}[i]
		job, err := qq.Job(ctx, trees[i].Job.ID)
		if err != nil || job == nil || string(job.ReturnValue) != want {
			t.Fatalf("parent %d = %+v (%v), want return value %s", i, job, err, want)
		}
	}

	// A rejected root is reported. Redis adds the other flow anyway;
	// PostgreSQL rolls the batch back (see the postgresbackend tests).
	_, err = fp.AddBulk(ctx, []bullmq.FlowJob{
		{Name: "ok", QueueName: q.Name()},
		{Name: "orphan", QueueName: q.Name(), Opts: &bullmq.JobOptions{
			Parent: &bullmq.ParentOptions{ID: "missing", Queue: q.Name()},
		}},
	})
	if !errors.Is(err, bullmq.ErrParentJobNotExist) {
		t.Fatalf("AddBulk with a missing parent: %v, want ErrParentJobNotExist", err)
	}
}

func TestFlowProducerGetFlow(t *testing.T) {
	forEachBackend(t, testFlowProducerGetFlow)
}

func testFlowProducerGetFlow(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	otherQ := newSuffixedQueue(t, be, "other")
	fp := newTestFlowProducer(t, be)

	added, err := fp.Add(ctx, bullmq.FlowJob{
		Name: "root", QueueName: q.Name(),
		Children: []bullmq.FlowJob{
			{Name: "mid", QueueName: otherQ.Name(), Children: []bullmq.FlowJob{
				{Name: "leaf-a", QueueName: q.Name()},
				{Name: "leaf-b", QueueName: otherQ.Name()},
			}},
			{Name: "done", QueueName: otherQ.Name()},
		},
	}, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	// Complete one child so the tree spans several statuses.
	runWorker(t, newTestWorker(t, be, otherQ.Name(), func(context.Context, *bullmq.Job) (any, error) {
		return "ok", nil
	}, nil))
	waitForState(t, otherQ, added.Children[1].Job.ID, bullmq.StateCompleted)
	waitForState(t, otherQ, added.Children[0].Children[1].Job.ID, bullmq.StateCompleted)

	// describe renders a tree as "name(child child)", children sorted.
	var describe func(n *bullmq.JobNode) string
	describe = func(n *bullmq.JobNode) string {
		if len(n.Children) == 0 {
			return n.Job.Name
		}
		var parts []string
		for _, c := range n.Children {
			parts = append(parts, describe(c))
		}
		slices.Sort(parts)
		return n.Job.Name + "(" + strings.Join(parts, " ") + ")"
	}

	flow, err := fp.GetFlow(ctx, bullmq.FlowGetOptions{ID: added.Job.ID, QueueName: q.Name()})
	if err != nil {
		t.Fatalf("GetFlow: %v", err)
	}
	if got, want := describe(flow), "root(done mid(leaf-a leaf-b))"; got != want {
		t.Fatalf("flow = %s, want %s", got, want)
	}
	if flow.Job.ID != added.Job.ID || flow.Job.QueueName != q.Name() {
		t.Fatalf("root = %+v", flow.Job)
	}
	for _, c := range flow.Children {
		if c.Job.QueueName != otherQ.Name() || c.Job.Parent == nil || c.Job.Parent.ID != added.Job.ID {
			t.Fatalf("child = %+v", c.Job)
		}
		if c.Job.Name == "done" && string(c.Job.ReturnValue) != `"ok"` {
			t.Fatalf("completed child return value = %s", c.Job.ReturnValue)
		}
		// Returned jobs are bound to their queue.
		if state, err := c.Job.State(ctx); err != nil || state == bullmq.StateUnknown {
			t.Fatalf("State of %s = %q (%v)", c.Job.Name, state, err)
		}
	}

	shallow, err := fp.GetFlow(ctx, bullmq.FlowGetOptions{ID: added.Job.ID, QueueName: q.Name(), Depth: 2})
	if err != nil {
		t.Fatalf("GetFlow: %v", err)
	}
	if got, want := describe(shallow), "root(done mid)"; got != want {
		t.Fatalf("flow with depth 2 = %s, want %s", got, want)
	}
	single, err := fp.GetFlow(ctx, bullmq.FlowGetOptions{ID: added.Job.ID, QueueName: q.Name(), Depth: 1})
	if err != nil || describe(single) != "root" {
		t.Fatalf("flow with depth 1 = %v (%v)", single, err)
	}
	missing, err := fp.GetFlow(ctx, bullmq.FlowGetOptions{ID: "missing", QueueName: q.Name()})
	if err != nil || missing != nil {
		t.Fatalf("GetFlow(missing) = %v, %v; want nil, nil", missing, err)
	}
}

func TestFlowProducerDeduplication(t *testing.T) {
	forEachBackend(t, testFlowProducerDeduplication)
}

func testFlowProducerDeduplication(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	fp := newTestFlowProducer(t, be)
	dedup := func(id string) *bullmq.JobOptions {
		return &bullmq.JobOptions{Deduplication: &bullmq.DeduplicationOptions{ID: id}, Delay: bullmq.Int64(60_000)}
	}

	for name, flow := range map[string]bullmq.FlowJob{
		"root with children": {Name: "root", QueueName: q.Name(), Opts: dedup("a"),
			Children: []bullmq.FlowJob{{Name: "child", QueueName: q.Name()}}},
		"nested node with children": {Name: "root", QueueName: q.Name(), Children: []bullmq.FlowJob{
			{Name: "mid", QueueName: q.Name(), Opts: dedup("b"), Children: []bullmq.FlowJob{{Name: "leaf", QueueName: q.Name()}}},
		}},
		"child": {Name: "root", QueueName: q.Name(), Children: []bullmq.FlowJob{
			{Name: "child", QueueName: q.Name(), Opts: dedup("c")},
		}},
	} {
		var cfg *bullmq.ConfigError
		if _, err := fp.Add(ctx, flow, nil); !errors.As(err, &cfg) {
			t.Fatalf("%s: Add error = %v, want a ConfigError", name, err)
		}
	}
	if n, err := q.Count(ctx); err != nil || n != 0 {
		t.Fatalf("jobs added by rejected flows = %d (%v), want 0", n, err)
	}

	// A root without children nor parent is deduplicated as a plain job.
	first, err := fp.Add(ctx, bullmq.FlowJob{Name: "root", QueueName: q.Name(), Data: 1, Opts: dedup("root")}, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	second, err := fp.Add(ctx, bullmq.FlowJob{Name: "root", QueueName: q.Name(), Data: 2, Opts: dedup("root")}, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	trees, err := fp.AddBulk(ctx, []bullmq.FlowJob{
		{Name: "root", QueueName: q.Name(), Data: 3, Opts: dedup("root")},
		{Name: "root", QueueName: q.Name(), Data: 4, Opts: dedup("root")},
	})
	if err != nil {
		t.Fatalf("AddBulk: %v", err)
	}
	for _, id := range []string{second.Job.ID, trees[0].Job.ID, trees[1].Job.ID} {
		if id != first.Job.ID {
			t.Fatalf("deduplicated ids = %s, %s, %s; want %s", second.Job.ID, trees[0].Job.ID, trees[1].Job.ID, first.Job.ID)
		}
	}
	if jobID, _, ok, err := be.Fixture.Deduplication(ctx, q.Backend(), "root"); err != nil || !ok || jobID != first.Job.ID {
		t.Fatalf("deduplication entry = %q, %v (%v); want %s", jobID, ok, err, first.Job.ID)
	}
	if n, err := q.Count(ctx); err != nil || n != 1 {
		t.Fatalf("jobs = %d (%v), want 1", n, err)
	}
}

func TestFlowProducerRejectsJobsThatCannotBeAttached(t *testing.T) {
	forEachBackend(t, testFlowProducerRejectsJobsThatCannotBeAttached)
}

func testFlowProducerRejectsJobsThatCannotBeAttached(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	fp := newTestFlowProducer(t, be)

	// The parent of the root does not exist: nothing is added.
	_, err := fp.Add(ctx, bullmq.FlowJob{
		Name: "orphan", QueueName: q.Name(),
		Opts:     &bullmq.JobOptions{JobID: "orphan", Parent: &bullmq.ParentOptions{ID: "missing", Queue: q.Name()}},
		Children: []bullmq.FlowJob{{Name: "child", QueueName: q.Name(), Opts: &bullmq.JobOptions{JobID: "orphan-child"}}},
	}, nil)
	if !errors.Is(err, bullmq.ErrParentJobNotExist) {
		t.Fatalf("Add with a missing parent: %v, want ErrParentJobNotExist", err)
	}
	for _, id := range []string{"orphan", "orphan-child"} {
		if job, err := q.Job(ctx, id); err != nil || job != nil {
			t.Fatalf("job %s was added (%v)", id, err)
		}
	}

	// A child that already belongs to another parent cannot be moved.
	if _, err := fp.Add(ctx, bullmq.FlowJob{Name: "first", QueueName: q.Name(), Opts: &bullmq.JobOptions{JobID: "first"},
		Children: []bullmq.FlowJob{{Name: "shared", QueueName: q.Name(), Opts: &bullmq.JobOptions{JobID: "shared"}}},
	}, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	_, err = fp.Add(ctx, bullmq.FlowJob{Name: "second", QueueName: q.Name(), Opts: &bullmq.JobOptions{JobID: "second"},
		Children: []bullmq.FlowJob{{Name: "shared", QueueName: q.Name(), Opts: &bullmq.JobOptions{JobID: "shared"}}},
	}, nil)
	if !errors.Is(err, bullmq.ErrParentJobCannotBeReplaced) {
		t.Fatalf("Add with a child of another parent: %v, want ErrParentJobCannotBeReplaced", err)
	}
	shared, err := q.Job(ctx, "shared")
	if err != nil || shared == nil || shared.Parent == nil || shared.Parent.ID != "first" {
		t.Fatalf("shared child = %+v (%v), want it to keep its parent", shared, err)
	}
}

func TestFlowProducerReleasesParentsOnlyOnceTheTreeIsAdded(t *testing.T) {
	forEachBackend(t, testFlowProducerReleasesParentsOnlyOnceTheTreeIsAdded)
}

func testFlowProducerReleasesParentsOnlyOnceTheTreeIsAdded(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	fp := newTestFlowProducer(t, be)

	done := make(chan struct{})
	w := newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) {
		close(done)
		return "mon-value", nil
	}, nil)
	runWorker(t, w)
	if _, err := q.Add(ctx, "mon", nil, &bullmq.JobOptions{JobID: "mon"}); err != nil {
		t.Fatalf("Add: %v", err)
	}
	<-done
	waitForState(t, q, "mon", bullmq.StateCompleted)
	if err := w.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	// The completed child comes first: it must not release the parent while
	// its sibling has not been added yet.
	tree, err := fp.Add(ctx, bullmq.FlowJob{
		Name: "tue", QueueName: q.Name(), Opts: &bullmq.JobOptions{JobID: "tue"},
		Children: []bullmq.FlowJob{
			{Name: "mon", QueueName: q.Name(), Opts: &bullmq.JobOptions{JobID: "mon"}},
			{Name: "wed", QueueName: q.Name(), Opts: &bullmq.JobOptions{JobID: "wed"}},
		},
	}, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	requireState(t, ctx, q, tree.Job.ID, bullmq.StateWaitingChildren)
	requireState(t, ctx, q, "wed", bullmq.StateWaiting)
	requireCounts(t, ctx, tree.Job, bullmq.DependencyCounts{Processed: 1, Unprocessed: 1})

	// A parent whose children all exist and are completed is released once
	// the flow is added.
	if _, err := q.Add(ctx, "fri-child", nil, &bullmq.JobOptions{JobID: "fri-child"}); err != nil {
		t.Fatalf("Add: %v", err)
	}
	values := make(chan map[string]json.RawMessage, 1)
	runWorker(t, newTestWorker(t, be, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		if job.ID == "fri" {
			v, err := job.ChildrenValues(ctx)
			if err != nil {
				return nil, err
			}
			values <- v
		}
		return job.ID + "-value", nil
	}, nil))
	waitForState(t, q, "fri-child", bullmq.StateCompleted)
	waitForState(t, q, tree.Job.ID, bullmq.StateCompleted)

	if _, err := fp.Add(ctx, bullmq.FlowJob{
		Name: "fri", QueueName: q.Name(), Opts: &bullmq.JobOptions{JobID: "fri"},
		Children: []bullmq.FlowJob{
			{Name: "fri-child", QueueName: q.Name(), Opts: &bullmq.JobOptions{JobID: "fri-child"}},
		},
	}, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	select {
	case v := <-values:
		if string(v[jobKey(q, "fri-child")]) != `"fri-child-value"` {
			t.Fatalf("children values = %s", v)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("a parent whose children were all completed was not released")
	}
}

func TestFlowStepJobsWaitForChildrenAddedAtRuntime(t *testing.T) {
	forEachBackend(t, testFlowStepJobsWaitForChildrenAddedAtRuntime)
}

func testFlowStepJobsWaitForChildrenAddedAtRuntime(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	childQ := newSuffixedQueue(t, be, "children")
	grandchildQ := newSuffixedQueue(t, be, "grandchildren")
	fp := newTestFlowProducer(t, be)

	const (
		stepInitial = iota
		stepWait
		stepFinish
	)
	type stepData struct{ Step int }
	var runs atomic.Int32
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		runs.Add(1)
		var d stepData
		if err := job.DecodeData(&d); err != nil {
			return nil, err
		}
		for {
			switch d.Step {
			case stepInitial:
				// Add a whole flow under the running job.
				if _, err := fp.Add(ctx, bullmq.FlowJob{
					Name: "child", QueueName: childQ.Name(),
					Opts: &bullmq.JobOptions{Parent: &bullmq.ParentOptions{ID: job.ID, Queue: job.QueueName}},
					Children: []bullmq.FlowJob{
						{Name: "grandchild", QueueName: grandchildQ.Name(), Data: 1},
						{Name: "grandchild", QueueName: grandchildQ.Name(), Data: 2},
					},
				}, nil); err != nil {
					return nil, err
				}
				d.Step = stepWait
				if err := job.UpdateData(ctx, d); err != nil {
					return nil, err
				}
			case stepWait:
				moved, err := job.MoveToWaitingChildren(ctx, nil)
				if err != nil {
					return nil, err
				}
				if moved {
					return nil, bullmq.ErrWaitingChildren
				}
				d.Step = stepFinish
				if err := job.UpdateData(ctx, d); err != nil {
					return nil, err
				}
			default:
				values, err := job.ChildrenValues(ctx)
				if err != nil {
					return nil, err
				}
				return len(values), nil
			}
		}
	}, nil)
	runWorker(t, w)
	slow := func(_ context.Context, job *bullmq.Job) (any, error) {
		time.Sleep(50 * time.Millisecond)
		return job.Name, nil
	}
	runWorker(t, newTestWorker(t, be, childQ.Name(), slow, nil))
	runWorker(t, newTestWorker(t, be, grandchildQ.Name(), slow, nil))

	job, err := q.Add(ctx, "steps", stepData{Step: stepInitial}, &bullmq.JobOptions{Attempts: bullmq.Int64(3)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	waitForState(t, q, job.ID, bullmq.StateCompleted)
	stored, err := q.Job(ctx, job.ID)
	if err != nil || stored == nil {
		t.Fatalf("Job: %v", err)
	}
	if string(stored.ReturnValue) != "1" || stored.AttemptsMade != 1 {
		t.Fatalf("return value = %s, attempts = %d; want 1, 1", stored.ReturnValue, stored.AttemptsMade)
	}
	if n := runs.Load(); n != 2 {
		t.Fatalf("parent ran %d times, want 2", n)
	}
}
