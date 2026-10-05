package bullmq

import (
	"testing"
	"time"
)

func TestBackoffDelayUnknownStrategyWithoutHandler(t *testing.T) {
	w := &Worker{}
	job := &Job{ID: "1", Opts: &JobOptions{Backoff: &Backoff{Type: "custom"}}}
	if _, err := w.backoffDelay(job, nil); err == nil {
		t.Fatal("backoffDelay succeeded for an unknown strategy without BackoffStrategy, want error")
	}
}

func TestBackoffDelayCustomStrategy(t *testing.T) {
	w := &Worker{opts: WorkerOptions{
		BackoffStrategy: func(int64, BackoffType, error, *Job) int64 { return 250 },
	}}
	job := &Job{ID: "1", Opts: &JobOptions{Backoff: &Backoff{Type: "custom"}}}
	d, err := w.backoffDelay(job, nil)
	if err != nil {
		t.Fatalf("backoffDelay: %v", err)
	}
	if d != 250*time.Millisecond {
		t.Fatalf("delay = %v, want 250ms", d)
	}
}
