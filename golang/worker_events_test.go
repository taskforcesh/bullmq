package bullmq_test

import (
	"context"
	"errors"
	"slices"
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

// runUntilClosed starts w and returns a function that closes it and reports
// whether it stopped within the timeout.
func runUntilClosed(t *testing.T, w *bullmq.Worker) func(timeout time.Duration) bool {
	t.Helper()
	runDone := make(chan struct{})
	go func() {
		defer close(runDone)
		_ = w.Run(context.Background())
	}()
	var once sync.Once
	stop := func(timeout time.Duration) bool {
		stopped := false
		once.Do(func() {
			closeDone := make(chan struct{})
			go func() {
				defer close(closeDone)
				_ = w.Close()
			}()
			select {
			case <-closeDone:
				<-runDone
				stopped = true
			case <-time.After(timeout):
			}
		})
		return stopped
	}
	t.Cleanup(func() { stop(10 * time.Second) })
	return stop
}

// Pausing from the EventDrained callback, which runs on the worker's fetch
// loop, waits for the jobs still running and then returns.
func TestWorkerPauseFromTheDrainedEvent(t *testing.T) {
	forEachBackend(t, testWorkerPauseFromTheDrainedEvent)
}

func testWorkerPauseFromTheDrainedEvent(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	long, err := q.Add(ctx, "long", nil, nil)
	if err != nil {
		t.Fatalf("Add: %v", err)
	}

	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseLong := func() { releaseOnce.Do(func() { close(release) }) }
	t.Cleanup(releaseLong)
	var w *bullmq.Worker
	var pausing atomic.Bool
	paused := make(chan error, 1)
	var processed atomic.Int64
	w = newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) {
		processed.Add(1)
		<-release
		return nil, nil
	}, &bullmq.WorkerOptions{
		Concurrency: 2,
		OnEvent: func(ev bullmq.Event) {
			if ev.Type == bullmq.EventDrained && pausing.CompareAndSwap(false, true) {
				pctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				paused <- w.Pause(pctx, false)
			}
		},
	})
	stop := runUntilClosed(t, w)

	waitFor(t, 5*time.Second, "the callback to pause the worker", pausing.Load)
	time.Sleep(200 * time.Millisecond)
	select {
	case err := <-paused:
		t.Fatalf("Pause returned (%v) while a job was still running", err)
	default:
	}
	releaseLong()
	select {
	case err := <-paused:
		if err != nil {
			t.Fatalf("Pause from the drained event: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Pause from the drained event did not return once the running job finished")
	}
	requireState(t, ctx, q, long.ID, bullmq.StateCompleted)

	if _, err := q.Add(ctx, "while-paused", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}
	time.Sleep(300 * time.Millisecond)
	if got := processed.Load(); got != 1 {
		t.Errorf("the paused worker processed %d jobs, want 1", got)
	}
	if !stop(5 * time.Second) {
		t.Fatal("Close did not stop the worker")
	}
}

// Pausing from a job's EventCompleted callback, which runs on that job's
// slot, waits for the other jobs only. A job the slot fetched to process next
// is put back instead of being started after Pause returned.
func TestWorkerPauseFromACompletedEvent(t *testing.T) {
	forEachBackend(t, testWorkerPauseFromACompletedEvent)
}

func testWorkerPauseFromACompletedEvent(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	ids := map[string]string{}
	for _, name := range []string{"quick", "long", "next"} {
		job, err := q.Add(ctx, name, nil, nil)
		if err != nil {
			t.Fatalf("Add: %v", err)
		}
		ids[name] = job.ID
	}

	release := make(chan struct{})
	var releaseOnce sync.Once
	releaseLong := func() { releaseOnce.Do(func() { close(release) }) }
	t.Cleanup(releaseLong)
	var w *bullmq.Worker
	var mu sync.Mutex
	var started []string
	var longDone atomic.Bool
	pausing := make(chan struct{})
	paused := make(chan error, 1)
	w = newTestWorker(t, be, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
		mu.Lock()
		started = append(started, job.Name)
		mu.Unlock()
		if job.Name == "long" {
			<-release
			longDone.Store(true)
		}
		return nil, nil
	}, &bullmq.WorkerOptions{
		Concurrency: 2,
		OnEvent: func(ev bullmq.Event) {
			if ev.Type == bullmq.EventCompleted && ev.Job.Name == "quick" {
				close(pausing)
				pctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				err := w.Pause(pctx, false)
				if err == nil && !longDone.Load() {
					err = errors.New("returned before the other job finished")
				}
				paused <- err
			}
		},
	})
	stop := runUntilClosed(t, w)

	select {
	case <-pausing:
	case <-time.After(10 * time.Second):
		t.Fatal("the quick job did not complete")
	}
	time.Sleep(200 * time.Millisecond)
	releaseLong()
	select {
	case err := <-paused:
		if err != nil {
			t.Fatalf("Pause from the completed event: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Pause from the completed event did not return once the other job finished")
	}

	// The job fetched while finishing the quick one goes back to wait.
	waitFor(t, 5*time.Second, "the next job to be put back", func() bool {
		state, err := q.JobState(ctx, ids["next"])
		return err == nil && state == bullmq.StateWaiting
	})
	time.Sleep(200 * time.Millisecond)
	mu.Lock()
	if slices.Contains(started, "next") {
		t.Errorf("the paused worker started the next job (started %v)", started)
	}
	mu.Unlock()

	w.Resume()
	waitFor(t, 5*time.Second, "the next job to complete after resuming", func() bool {
		state, err := q.JobState(ctx, ids["next"])
		return err == nil && state == bullmq.StateCompleted
	})
	if !stop(5 * time.Second) {
		t.Fatal("Close did not stop the worker")
	}
}

// Close stops a worker even when an OnEvent callback waits in Pause for the
// very job it was called for; Pause then reports the worker closed.
func TestWorkerCloseReleasesAPauseWaitingForItsOwnJob(t *testing.T) {
	forEachBackend(t, testWorkerCloseReleasesAPauseWaitingForItsOwnJob)
}

func testWorkerCloseReleasesAPauseWaitingForItsOwnJob(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	if _, err := q.Add(ctx, "job", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}

	var w *bullmq.Worker
	pausing := make(chan struct{})
	paused := make(chan error, 1)
	w = newTestWorker(t, be, q.Name(), func(context.Context, *bullmq.Job) (any, error) {
		return nil, nil
	}, &bullmq.WorkerOptions{
		OnEvent: func(ev bullmq.Event) {
			if ev.Type == bullmq.EventActive {
				close(pausing)
				paused <- w.Pause(context.Background(), false)
			}
		},
	})
	stop := runUntilClosed(t, w)

	select {
	case <-pausing:
	case <-time.After(10 * time.Second):
		t.Fatal("the job did not start")
	}
	if !stop(5 * time.Second) {
		t.Fatal("Close did not stop the worker")
	}
	if err := <-paused; !errors.Is(err, bullmq.ErrWorkerClosed) {
		t.Errorf("Pause = %v, want ErrWorkerClosed", err)
	}
}
