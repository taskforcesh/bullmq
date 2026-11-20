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
