package bullmq_test

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// OnEvent sees every event, even when nobody drains the Events channel and
// the channel drops them; the drops are counted.
func TestWorkerOnEventSeesEveryEvent(t *testing.T) {
	forEachBackend(t, testWorkerOnEventSeesEveryEvent)
}

func testWorkerOnEventSeesEveryEvent(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)

	const total = 300
	specs := make([]bullmq.JobSpec, total)
	for i := range specs {
		specs[i] = bullmq.JobSpec{Name: "observed", Data: i}
	}
	if _, err := q.AddBulk(ctx, specs); err != nil {
		t.Fatalf("AddBulk: %v", err)
	}

	var mu sync.Mutex
	completed := map[string]bool{}
	var active atomic.Int64
	w := newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) {
		return nil, nil
	}, &bullmq.WorkerOptions{
		Concurrency: 4,
		OnEvent: func(ev bullmq.Event) {
			switch ev.Type {
			case bullmq.EventActive:
				active.Add(1)
			case bullmq.EventCompleted:
				mu.Lock()
				completed[ev.Job.ID] = true
				mu.Unlock()
			}
		},
	})
	runWorker(t, w)

	waitFor(t, 20*time.Second, "OnEvent to see every completion", func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(completed) == total
	})
	if got := active.Load(); got != total {
		t.Errorf("OnEvent saw %d active events, want %d", got, total)
	}
	if w.DroppedEvents() == 0 {
		t.Error("DroppedEvents = 0, although the Events channel was never drained")
	}
}

// Progress reported by a goroutine that outlives its job, even after the
// worker is closed, neither races nor panics.
func TestWorkerProgressFromAGoroutineThatOutlivesTheJob(t *testing.T) {
	forEachBackend(t, testWorkerProgressFromAGoroutineThatOutlivesTheJob)
}

func testWorkerProgressFromAGoroutineThatOutlivesTheJob(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	job, err := q.Add(ctx, "chatty", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	stop := make(chan struct{})
	var reporters sync.WaitGroup
	w := newTestWorker(t, be, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
		reporters.Add(1)
		go func() {
			defer reporters.Done()
			for i := 0; ; i++ {
				select {
				case <-stop:
					return
				default:
				}
				p, _ := bullmq.NumberProgress(float64(i))
				_ = job.UpdateProgress(context.Background(), p)
				time.Sleep(time.Millisecond)
			}
		}()
		return nil, nil
	}, nil)
	runCtx, cancelRun := context.WithCancel(context.Background())
	defer cancelRun()
	runDone := make(chan struct{})
	go func() {
		defer close(runDone)
		_ = w.Run(runCtx)
	}()

	waitFor(t, 10*time.Second, "the job to complete", func() bool {
		state, err := q.JobState(ctx, job.ID)
		return err == nil && state == bullmq.StateCompleted
	})
	time.Sleep(50 * time.Millisecond)
	if err := w.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	<-runDone
	time.Sleep(50 * time.Millisecond)
	close(stop)
	reporters.Wait()
}
