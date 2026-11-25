package bullmq_test

import (
	"encoding/json"
	"testing"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// The removal policies are stored in the form Node.js writes them:
// KeepCount(n) as the number n, RemoveAll as true, and an age as an object.
// A job read back keeps the stored form, which is written again as is.
func TestRemovalPoliciesAreStoredInNodeForm(t *testing.T) {
	forEachBackend(t, testRemovalPoliciesAreStoredInNodeForm)
}

func testRemovalPoliciesAreStoredInNodeForm(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	for _, tc := range []struct {
		policy *bullmq.RemoveOnFinish
		want   string
	}{
		{bullmq.KeepCount(1000), `1000`},
		{bullmq.RemoveAll(), `true`},
		{bullmq.KeepAge(3600), `{"age":3600}`},
	} {
		job, err := q.Add(ctx, "keep", nil, &bullmq.JobOptions{RemoveOnComplete: tc.policy, RemoveOnFail: tc.policy})
		if err != nil {
			t.Fatalf("Add: %v", err)
		}
		stored, err := q.Job(ctx, job.ID)
		if err != nil || stored == nil {
			t.Fatalf("Job = %v, %v", stored, err)
		}
		for name, got := range map[string]*bullmq.RemoveOnFinish{
			"removeOnComplete": stored.Opts.RemoveOnComplete,
			"removeOnFail":     stored.Opts.RemoveOnFail,
		} {
			raw, err := json.Marshal(got)
			if err != nil || string(raw) != tc.want {
				t.Errorf("stored %s = %s (%v), want %s", name, raw, err, tc.want)
			}
		}
	}
}

// A job added without data is stored with {}, as Node stores it, by Add,
// AddBulk and flows alike, so processors of other ports get an object.
func TestNilDataIsStoredAsAnEmptyObject(t *testing.T) {
	forEachBackend(t, testNilDataIsStoredAsAnEmptyObject)
}

func testNilDataIsStoredAsAnEmptyObject(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	added, err := q.Add(ctx, "none", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	var typedNil map[string]any
	bulk, err := q.AddBulk(ctx, []bullmq.JobSpec{{Name: "none"}, {Name: "typed", Data: typedNil}})
	if err != nil {
		t.Fatalf("AddBulk: %v", err)
	}
	tree, err := newTestFlowProducer(t, be).Add(ctx, bullmq.FlowJob{Name: "root", QueueName: q.Name(),
		Children: []bullmq.FlowJob{{Name: "child", QueueName: q.Name()}}}, nil)
	if err != nil {
		t.Fatalf("FlowProducer.Add: %v", err)
	}

	for _, job := range []*bullmq.Job{added, bulk[0], bulk[1], tree.Job, tree.Children[0].Job} {
		if string(job.Data) != `{}` {
			t.Errorf("returned job %s has data %s, want {}", job.Name, job.Data)
		}
		stored, err := q.Job(ctx, job.ID)
		if err != nil || stored == nil {
			t.Fatalf("Job(%s) = %v, %v", job.ID, stored, err)
		}
		if string(stored.Data) != `{}` {
			t.Errorf("stored job %s has data %s, want {}", job.Name, stored.Data)
		}
	}
}
