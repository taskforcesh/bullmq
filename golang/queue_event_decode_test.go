package bullmq_test

import (
	"context"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// QueueEvent decodes the fields Node's QueueEvents parses: the return value
// of completed, the data of progress and the delay of delayed.
func TestQueueEventDecodesItsFields(t *testing.T) {
	forEachBackend(t, testQueueEventDecodesItsFields)
}

func testQueueEventDecodesItsFields(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	qe, err := bullmq.NewQueueEvents(q.Name(), &bullmq.QueueEventsOptions{
		Backend: be.Factory, LastEventID: "0", BlockingTimeout: 200 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("NewQueueEvents: %v", err)
	}
	runCtx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = qe.Run(runCtx)
	}()
	defer func() {
		cancel()
		<-done
		_ = qe.Close()
	}()

	type result struct{ Sent int }
	w := newTestWorker(t, be, q.Name(), func(ctx context.Context, job *bullmq.Job) (any, error) {
		if err := job.UpdateProgress(ctx, map[string]int{"pct": 50}); err != nil {
			return nil, err
		}
		if err := job.UpdateProgress(ctx, 75); err != nil {
			return nil, err
		}
		return result{Sent: 3}, nil
	}, nil)
	runWorker(t, w)
	if _, err := q.Add(ctx, "now", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	delayed, err := q.Add(ctx, "later", nil, &bullmq.JobOptions{Delay: bullmq.Int64(60_000)})
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	var gotObject, gotNumber, gotCompleted, gotDelayed bool
	timeout := time.After(10 * time.Second)
	for !(gotObject && gotNumber && gotCompleted && gotDelayed) {
		select {
		case ev := <-qe.Events():
			switch ev.Event {
			case "progress":
				p, err := ev.Progress()
				if err != nil {
					t.Fatalf("Progress: %v", err)
				}
				if n, ok := p.Number(); ok {
					gotNumber = n == 75
					continue
				}
				var v map[string]int
				if err := ev.DecodeProgress(&v); err != nil || v["pct"] != 50 {
					t.Fatalf("DecodeProgress = %v, %v; want pct 50", v, err)
				}
				gotObject = true
			case "completed":
				var r result
				if err := ev.DecodeReturnValue(&r); err != nil || r.Sent != 3 {
					t.Fatalf("DecodeReturnValue = %+v, %v; want Sent 3", r, err)
				}
				gotCompleted = true
			case "delayed":
				until, ok := ev.DelayedUntil()
				want := time.UnixMilli(delayed.Timestamp + 60_000)
				if !ok || until.Sub(want).Abs() > time.Second {
					t.Fatalf("DelayedUntil = %v, %v; want about %v", until, ok, want)
				}
				gotDelayed = true
			}
		case <-timeout:
			t.Fatalf("events seen: progress object %v, number %v, completed %v, delayed %v", gotObject, gotNumber, gotCompleted, gotDelayed)
		}
	}

	if _, ok := (bullmq.QueueEvent{Data: map[string]string{}}).DelayedUntil(); ok {
		t.Error("DelayedUntil of an event without delay reported a time")
	}
	if _, err := (bullmq.QueueEvent{Event: "added", Data: map[string]string{}}).Progress(); err == nil {
		t.Error("Progress of an event without data returned no error")
	}
	var none any
	if err := (bullmq.QueueEvent{Data: map[string]string{}}).DecodeReturnValue(&none); err != nil || none != nil {
		t.Errorf("DecodeReturnValue of an event without one = %v, %v", none, err)
	}
}
