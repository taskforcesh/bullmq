package bullmq

import (
	"context"
	"errors"
	"regexp"
	"slices"
	"strings"
	"testing"
)

var uuidRE = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func newStubFlowProducer(t *testing.T) (*FlowProducer, *flowStubState) {
	t.Helper()
	state := &flowStubState{}
	fp, err := NewFlowProducer(&FlowProducerOptions{Backend: newFlowStubFactory(state)})
	if err != nil {
		t.Fatalf("NewFlowProducer: %v", err)
	}
	return fp, state
}

func TestNewFlowProducerRequiresABackend(t *testing.T) {
	for _, opts := range []*FlowProducerOptions{nil, {}} {
		_, err := NewFlowProducer(opts)
		var cfg *ConfigError
		if !errors.As(err, &cfg) {
			t.Fatalf("NewFlowProducer(%v) error = %v, want a ConfigError", opts, err)
		}
	}
}

func TestFlowProducerSendsTheTreeParentsFirst(t *testing.T) {
	fp, state := newStubFlowProducer(t)
	ctx := context.Background()

	tree, err := fp.Add(ctx, FlowJob{
		Name:      "root",
		QueueName: "a",
		Data:      map[string]int{"n": 1},
		Opts: &JobOptions{
			JobID:  "root-id",
			Parent: &ParentOptions{ID: "grandparent", Queue: "z"},
		},
		Children: []FlowJob{
			{
				Name:      "child",
				QueueName: "b",
				// A child's own parent is replaced by its node's parent.
				Opts: &JobOptions{Parent: &ParentOptions{ID: "ignored", Queue: "x"}, Attempts: Int64(3)},
				Children: []FlowJob{
					{Name: "grandchild", QueueName: "c", Opts: &JobOptions{FailParentOnFailure: Bool(true)}},
				},
			},
			{Name: "leaf", QueueName: "a", Children: []FlowJob{}},
		},
	}, &FlowOpts{QueuesOptions: map[string]FlowQueueOptions{
		"b": {DefaultJobOptions: &JobOptions{Attempts: Int64(5), Priority: Int64(7)}},
	}})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	if len(state.flows) != 1 {
		t.Fatalf("AddFlow called %d times, want 1", len(state.flows))
	}
	entries := state.flows[0]
	var names []string
	for _, e := range entries {
		names = append(names, e.Job.Name)
	}
	if want := []string{"root", "child", "grandchild", "leaf"}; !slices.Equal(names, want) {
		t.Fatalf("entries = %v, want %v", names, want)
	}

	root, child, grandchild, leaf := entries[0], entries[1], entries[2], entries[3]
	for _, c := range []struct {
		e       FlowEntry
		queue   string
		waiting bool
		parent  *ParentOptions
	}{
		{root, "a", true, &ParentOptions{ID: "grandparent", Queue: "z"}},
		{child, "b", true, &ParentOptions{ID: "root-id", Queue: "stub:a"}},
		{grandchild, "c", false, &ParentOptions{ID: child.JobID, Queue: "stub:b"}},
		{leaf, "a", false, &ParentOptions{ID: "root-id", Queue: "stub:a"}},
	} {
		if c.e.QueueName != c.queue || c.e.WaitingChildren != c.waiting {
			t.Errorf("%s: queue %q waiting-children %v, want %q %v", c.e.Job.Name, c.e.QueueName, c.e.WaitingChildren, c.queue, c.waiting)
		}
		if got := c.e.Job.Opts.Parent; got == nil || *got != *c.parent {
			t.Errorf("%s: parent %+v, want %+v", c.e.Job.Name, got, c.parent)
		}
		if c.e.Job.Opts.Timestamp == 0 {
			t.Errorf("%s: no timestamp", c.e.Job.Name)
		}
	}
	if root.JobID != "root-id" || root.Job.Opts.JobID != "root-id" {
		t.Errorf("root ids = %q / %q, want the custom id", root.JobID, root.Job.Opts.JobID)
	}
	for _, e := range []FlowEntry{child, grandchild, leaf} {
		if !uuidRE.MatchString(e.JobID) {
			t.Errorf("%s: generated id %q is not a UUID", e.Job.Name, e.JobID)
		}
		if e.Job.Opts.JobID != "" {
			t.Errorf("%s: generated id stored in the options as %q", e.Job.Name, e.Job.Opts.JobID)
		}
	}
	if *child.Job.Opts.Attempts != 3 || *child.Job.Opts.Priority != 7 {
		t.Errorf("child options = %+v, want its own attempts and the queue default priority", child.Job.Opts)
	}
	if grandchild.Job.Opts.Attempts != nil || !*grandchild.Job.Opts.FailParentOnFailure {
		t.Errorf("grandchild options = %+v, want no queue b default and fpof", grandchild.Job.Opts)
	}
	if string(root.Job.Data) != `{"n":1}` {
		t.Errorf("root data = %s", root.Job.Data)
	}

	if tree.Job.ID != "root-id" || tree.Job.QueueName != "a" || tree.Job.ParentKey != "stub:z:grandparent" {
		t.Errorf("root job = %+v", tree.Job)
	}
	if len(tree.Children) != 2 || len(tree.Children[0].Children) != 1 || tree.Children[1].Children != nil {
		t.Fatalf("tree shape is wrong: %+v", tree)
	}
	gc := tree.Children[0].Children[0].Job
	if gc.ID != grandchild.JobID || gc.QueueName != "c" || gc.Parent == nil ||
		gc.Parent.ID != child.JobID || gc.ParentKey != "stub:b:"+child.JobID {
		t.Errorf("grandchild job = %+v", gc)
	}
}

func TestFlowProducerUsesTheIDsTheBackendReturns(t *testing.T) {
	fp, state := newStubFlowProducer(t)
	state.ids = func(entries []FlowEntry) []string {
		ids := make([]string, len(entries))
		for i := range entries {
			ids[i] = "existing-" + entries[i].Job.Name
		}
		return ids
	}
	trees, err := fp.AddBulk(context.Background(), []FlowJob{
		{Name: "one", QueueName: "a", Opts: &JobOptions{Deduplication: &DeduplicationOptions{ID: "d"}}},
		{Name: "two", QueueName: "a"},
	})
	if err != nil {
		t.Fatalf("AddBulk: %v", err)
	}
	if len(state.flows) != 1 || len(state.flows[0]) != 2 {
		t.Fatalf("AddFlow calls = %v, want a single call with both flows", state.flows)
	}
	if trees[0].Job.ID != "existing-one" || trees[1].Job.ID != "existing-two" {
		t.Errorf("ids = %q, %q; want the ids the backend returned", trees[0].Job.ID, trees[1].Job.ID)
	}
	if trees, err := fp.AddBulk(context.Background(), nil); err != nil || trees != nil {
		t.Errorf("AddBulk(nil) = %v, %v; want nil, nil", trees, err)
	}
}

func TestFlowProducerRejectsInvalidFlows(t *testing.T) {
	leaf := func(opts *JobOptions) FlowJob { return FlowJob{Name: "leaf", QueueName: "q", Opts: opts} }
	dedup := &JobOptions{Deduplication: &DeduplicationOptions{ID: "d"}}
	cases := map[string]struct {
		flow FlowJob
		msg  string
	}{
		"deduplication on a root with children": {
			FlowJob{Name: "root", QueueName: "q", Opts: dedup, Children: []FlowJob{leaf(nil)}},
			"deduplication options cannot be used on flow nodes with children",
		},
		"deduplication on a nested node with children": {
			FlowJob{Name: "root", QueueName: "q", Children: []FlowJob{
				{Name: "mid", QueueName: "q", Opts: dedup, Children: []FlowJob{leaf(nil)}},
			}},
			"deduplication options cannot be used on flow nodes with children",
		},
		"deduplication on a child": {
			FlowJob{Name: "root", QueueName: "q", Children: []FlowJob{leaf(dedup)}},
			"deduplication and parent options cannot be used together",
		},
		"deduplication on a root with a parent": {
			FlowJob{Name: "root", QueueName: "q", Opts: &JobOptions{
				Parent:        &ParentOptions{ID: "p", Queue: "q"},
				Deduplication: &DeduplicationOptions{ID: "d"},
			}},
			"deduplication and parent options cannot be used together",
		},
		"two parent failure options": {
			FlowJob{Name: "root", QueueName: "q", Children: []FlowJob{leaf(&JobOptions{
				FailParentOnFailure: Bool(true), IgnoreDependencyOnFailure: Bool(true),
			})}},
			"parent failure options are mutually exclusive",
		},
		"missing queue name": {
			FlowJob{Name: "root", QueueName: "q", Children: []FlowJob{{Name: "child"}}},
			"queue name must be provided",
		},
		"queue name with a colon": {
			FlowJob{Name: "root", QueueName: "bull:q"},
			"queue name cannot contain ':'",
		},
		"integer custom id": {
			FlowJob{Name: "root", QueueName: "q", Children: []FlowJob{leaf(&JobOptions{JobID: "42"})}},
			"custom job ID cannot be an integer",
		},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			fp, state := newStubFlowProducer(t)
			_, err := fp.Add(context.Background(), c.flow, nil)
			var cfg *ConfigError
			if !errors.As(err, &cfg) || !strings.Contains(err.Error(), c.msg) {
				t.Fatalf("Add error = %v, want a ConfigError containing %q", err, c.msg)
			}
			_, err = fp.AddBulk(context.Background(), []FlowJob{leaf(nil), c.flow})
			if !errors.As(err, &cfg) || !strings.Contains(err.Error(), c.msg) {
				t.Fatalf("AddBulk error = %v, want a ConfigError containing %q", err, c.msg)
			}
			if len(state.flows) != 0 {
				t.Fatalf("AddFlow was called with %v", state.flows)
			}
		})
	}
}

func TestFlowProducerCloseReleasesEveryBackend(t *testing.T) {
	fp, state := newStubFlowProducer(t)
	ctx := context.Background()
	if _, err := fp.Add(ctx, FlowJob{Name: "root", QueueName: "a", Children: []FlowJob{
		{Name: "child", QueueName: "b"},
	}}, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	if err := fp.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if err := fp.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
	slices.Sort(state.closed)
	if want := []string{flowProducerBackendName, "a", "b"}; !slices.Equal(state.closed, want) {
		t.Errorf("closed backends = %v, want %v", state.closed, want)
	}
	if _, err := fp.Add(ctx, FlowJob{Name: "root", QueueName: "a"}, nil); !errors.Is(err, ErrFlowProducerClosed) {
		t.Errorf("Add after Close error = %v, want ErrFlowProducerClosed", err)
	}
	if _, err := fp.GetFlow(ctx, FlowGetOptions{ID: "1", QueueName: "a"}); !errors.Is(err, ErrFlowProducerClosed) {
		t.Errorf("GetFlow after Close error = %v, want ErrFlowProducerClosed", err)
	}
}

func TestScriptErrorMapsParentJobCannotBeReplaced(t *testing.T) {
	err := &ScriptError{Code: ErrCodeParentJobCannotBeReplaced, Script: "addJob"}
	if !errors.Is(err, ErrParentJobCannotBeReplaced) {
		t.Errorf("errors.Is(%v, ErrParentJobCannotBeReplaced) = false", err)
	}
}
