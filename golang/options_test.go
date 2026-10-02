package bullmq

import (
	"testing"
	"time"
)

func TestApplyDefaultsRejectsSubMillisecondLockDuration(t *testing.T) {
	for _, d := range []time.Duration{time.Nanosecond, 999 * time.Microsecond} {
		o := WorkerOptions{LockDuration: d}
		if err := o.applyDefaults(); err == nil {
			t.Fatalf("LockDuration %v: expected error, got nil", d)
		}
	}
}

func TestApplyDefaultsAcceptsOneMillisecondLockDuration(t *testing.T) {
	o := WorkerOptions{LockDuration: time.Millisecond}
	if err := o.applyDefaults(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if o.LockRenewTime <= 0 {
		t.Fatalf("LockRenewTime = %v, want > 0", o.LockRenewTime)
	}
}

func TestApplyDefaultsUnsetLockDuration(t *testing.T) {
	var o WorkerOptions
	if err := o.applyDefaults(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if o.LockDuration != 30*time.Second {
		t.Fatalf("LockDuration = %v, want 30s", o.LockDuration)
	}
}
