package bullmq_test

import (
	"context"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// DecodeChildrenValues decodes the children's return values into a typed
// map, as DecodeData decodes the job's data.
func TestJobDecodeChildrenValues(t *testing.T) {
	forEachBackend(t, testJobDecodeChildrenValues)
}

func testJobDecodeChildrenValues(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	fp := newTestFlowProducer(t, be)

	type result struct {
		Cost float64 `json:"cost"`
	}
	totals := make(chan float64, 1)
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		if job.Name == "child" {
			var cost float64
			if err := job.DecodeData(&cost); err != nil {
				return nil, err
			}
			return result{Cost: cost}, nil
		}
		var values map[string]result
		if err := job.DecodeChildrenValues(ctx, &values); err != nil {
			return nil, err
		}
		total := 0.0
		for _, v := range values {
			total += v.Cost
		}
		totals <- total
		return total, nil
	}, nil)
	runWorker(t, w)

	tree, err := fp.Add(ctx, bullmq.FlowJob{Name: "parent", QueueName: q.Name(), Children: []bullmq.FlowJob{
		{Name: "child", QueueName: q.Name(), Data: 1.5},
		{Name: "child", QueueName: q.Name(), Data: 2.25},
	}}, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	select {
	case total := <-totals:
		if total != 3.75 {
			t.Fatalf("total = %v, want 3.75", total)
		}
	case <-time.After(15 * time.Second):
		t.Fatal("the parent was not processed")
	}

	// The keys are the children's keys.
	var values map[string]result
	if err := tree.Job.DecodeChildrenValues(ctx, &values); err != nil {
		t.Fatalf("DecodeChildrenValues: %v", err)
	}
	if v, ok := values[jobKey(q, tree.Children[1].Job.ID)]; !ok || v.Cost != 2.25 {
		t.Fatalf("values = %+v, want the second child's cost under its key", values)
	}

	// A job without children decodes to an empty map.
	plain, err := q.Add(ctx, "plain", nil, &bullmq.JobOptions{Delay: bullmq.Int64(60_000)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}
	var none map[string]result
	if err := plain.DecodeChildrenValues(ctx, &none); err != nil || none == nil || len(none) != 0 {
		t.Fatalf("DecodeChildrenValues without children = %v, %v; want an empty map", none, err)
	}
	if err := plain.DecodeChildrenValues(ctx, none); err == nil {
		t.Fatal("DecodeChildrenValues into a non-pointer succeeded")
	}
}
