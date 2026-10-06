package bullmq

import (
	"bytes"
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

func TestBackoffDelayJitter(t *testing.T) {
	w := &Worker{}
	cases := []struct {
		name     string
		backoff  Backoff
		attempts int64
		min, max time.Duration
	}{
		{"fixed", Backoff{Type: BackoffFixed, Delay: 1000, Jitter: 0.5}, 0, 500 * time.Millisecond, 1000 * time.Millisecond},
		{"exponential", Backoff{Type: BackoffExponential, Delay: 1000, Jitter: 0.25}, 2, 3000 * time.Millisecond, 4000 * time.Millisecond},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			job := &Job{ID: "1", AttemptsMade: tc.attempts, Opts: &JobOptions{Backoff: &tc.backoff}}
			distinct := map[time.Duration]bool{}
			for range 200 {
				d, err := w.backoffDelay(job, nil)
				if err != nil {
					t.Fatalf("backoffDelay: %v", err)
				}
				if d < tc.min || d > tc.max {
					t.Fatalf("delay %v outside [%v, %v]", d, tc.min, tc.max)
				}
				distinct[d] = true
			}
			if len(distinct) < 2 {
				t.Fatal("delay is not jittered")
			}
		})
	}
}

func TestBackoffDelayNoJitterIsDeterministic(t *testing.T) {
	w := &Worker{}
	job := &Job{ID: "1", AttemptsMade: 2, Opts: &JobOptions{Backoff: &Backoff{Type: BackoffExponential, Delay: 100}}}
	d, err := w.backoffDelay(job, nil)
	if err != nil || d != 400*time.Millisecond {
		t.Fatalf("delay = %v, err = %v, want 400ms", d, err)
	}
}

func TestBackoffJitterValidation(t *testing.T) {
	for _, j := range []float64{-0.1, 1.5} {
		b := &Backoff{Type: BackoffFixed, Delay: 10, Jitter: j}
		if err := b.validate(); err == nil {
			t.Fatalf("validate accepted jitter %v", j)
		}
		w := &Worker{}
		job := &Job{ID: "1", Opts: &JobOptions{Backoff: b}}
		if _, err := w.backoffDelay(job, nil); err == nil {
			t.Fatalf("backoffDelay accepted jitter %v", j)
		}
	}
	for _, j := range []float64{0, 0.5, 1} {
		if err := (&Backoff{Type: BackoffFixed, Jitter: j}).validate(); err != nil {
			t.Fatalf("validate rejected jitter %v: %v", j, err)
		}
	}
}

func TestBackoffNegativeDelayRejected(t *testing.T) {
	for _, typ := range []BackoffType{BackoffFixed, BackoffExponential} {
		b := &Backoff{Type: typ, Delay: -1}
		if err := b.validate(); err == nil {
			t.Fatalf("validate accepted a negative delay for %s", typ)
		}
		w := &Worker{}
		job := &Job{ID: "1", Opts: &JobOptions{Backoff: b}}
		if _, err := w.backoffDelay(job, nil); err == nil {
			t.Fatalf("backoffDelay accepted a negative delay for %s", typ)
		}
	}
}

func TestBackoffMsgpackJitter(t *testing.T) {
	enc := func(b *Backoff) []byte {
		w := newMsgpackWriter(32)
		b.writeMsgpack(w)
		return w.Bytes()
	}
	without := enc(&Backoff{Type: BackoffFixed, Delay: 10})
	with := enc(&Backoff{Type: BackoffFixed, Delay: 10, Jitter: 0.5})
	if without[0] != 0x82 || with[0] != 0x83 {
		t.Fatalf("map headers = %#x, %#x; want 0x82, 0x83", without[0], with[0])
	}
	if !bytes.Contains(with, []byte("jitter")) || bytes.Contains(without, []byte("jitter")) {
		t.Fatal("jitter key presence is wrong")
	}
}
