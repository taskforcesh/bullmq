package postgresbackend

import (
	"errors"
	"fmt"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// add_flow returns a code for a job it cannot add and goes on with the
// others, so a failed batch or flow must be rolled back as a whole.
func TestABatchThatFailsAddsNoJob(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	factory := New(Options{ConnString: url, Schema: newSchema(t)})
	name := fmt.Sprintf("atomic-%d", time.Now().UnixNano())
	q, err := bullmq.NewQueue(name, &bullmq.QueueOptions{Backend: factory})
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	fp, err := bullmq.NewFlowProducer(&bullmq.FlowProducerOptions{Backend: factory})
	if err != nil {
		t.Fatal(err)
	}
	defer fp.Close()

	noJobs := func(what string) {
		t.Helper()
		counts, err := q.JobCounts(ctx)
		if err != nil {
			t.Fatalf("JobCounts: %v", err)
		}
		for state, n := range counts {
			if n != 0 {
				t.Errorf("%s left %d %s jobs", what, n, state)
			}
		}
	}

	_, err = q.AddBulk(ctx, []bullmq.JobSpec{
		{Name: "a", Data: 1},
		{Name: "b", Data: 2, Opts: &bullmq.JobOptions{Parent: &bullmq.ParentOptions{ID: "missing", Queue: name}}},
		{Name: "c", Data: 3},
	})
	var scriptErr *bullmq.ScriptError
	if !errors.Is(err, bullmq.ErrParentJobNotExist) || !errors.As(err, &scriptErr) || scriptErr.Script != "add_flow" {
		t.Fatalf("AddBulk with a missing parent = %v, want ErrParentJobNotExist from add_flow", err)
	}
	noJobs("the failed AddBulk")

	_, err = fp.AddBulk(ctx, []bullmq.FlowJob{
		{Name: "ok", QueueName: name, Children: []bullmq.FlowJob{{Name: "child", QueueName: name}}},
		{Name: "orphan", QueueName: name, Opts: &bullmq.JobOptions{
			Parent: &bullmq.ParentOptions{ID: "missing", Queue: name},
		}},
	})
	if !errors.Is(err, bullmq.ErrParentJobNotExist) {
		t.Fatalf("FlowProducer.AddBulk with a missing parent = %v, want ErrParentJobNotExist", err)
	}
	noJobs("the failed FlowProducer.AddBulk")

	jobs, err := q.AddBulk(ctx, []bullmq.JobSpec{
		{Name: "a", Data: 1, Opts: &bullmq.JobOptions{Deduplication: &bullmq.DeduplicationOptions{ID: "d"}}},
		{Name: "b", Data: 2},
	})
	if err != nil || len(jobs) != 2 {
		t.Fatalf("AddBulk = %v, %v; want 2 jobs", jobs, err)
	}
	if n, err := q.Count(ctx); err != nil || n != 2 {
		t.Fatalf("Count = %d, %v; want 2", n, err)
	}
}
