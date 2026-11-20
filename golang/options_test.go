package bullmq

import (
	"context"
	"errors"
	"strings"
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

func TestApplyDefaultsOneMillisecondLockDuration(t *testing.T) {
	o := WorkerOptions{LockDuration: time.Millisecond}
	if err := o.applyDefaults(); err == nil {
		t.Fatal("expected error: default renewal interval would be sub-millisecond")
	}
	o = WorkerOptions{LockDuration: time.Millisecond, SkipLockRenewal: true}
	if err := o.applyDefaults(); err != nil {
		t.Fatalf("unexpected error with SkipLockRenewal: %v", err)
	}
}

func TestApplyDefaultsAcceptsTwoMillisecondLockDuration(t *testing.T) {
	o := WorkerOptions{LockDuration: 2 * time.Millisecond}
	if err := o.applyDefaults(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if o.LockRenewTime != time.Millisecond {
		t.Fatalf("LockRenewTime = %v, want 1ms", o.LockRenewTime)
	}
}

func TestApplyDefaultsValidatesLockRenewTime(t *testing.T) {
	bad := []WorkerOptions{
		{LockDuration: time.Second, LockRenewTime: 500 * time.Microsecond},
		{LockDuration: time.Second, LockRenewTime: time.Second},
		{LockDuration: time.Second, LockRenewTime: 2 * time.Second},
	}
	for _, o := range bad {
		if err := o.applyDefaults(); err == nil {
			t.Fatalf("LockDuration %v LockRenewTime %v: expected error", o.LockDuration, o.LockRenewTime)
		}
	}
	ok := WorkerOptions{LockDuration: time.Second, LockRenewTime: time.Millisecond}
	if err := ok.applyDefaults(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestApplyDefaultsRejectsSubMillisecondStalledInterval(t *testing.T) {
	for _, d := range []time.Duration{time.Nanosecond, 999 * time.Microsecond} {
		o := WorkerOptions{StalledInterval: d}
		if err := o.applyDefaults(); err == nil {
			t.Fatalf("StalledInterval %v: expected error, got nil", d)
		}
	}
	o := WorkerOptions{StalledInterval: time.Millisecond}
	if err := o.applyDefaults(); err != nil {
		t.Fatalf("1ms StalledInterval: unexpected error: %v", err)
	}
	o = WorkerOptions{StalledInterval: time.Microsecond, SkipStalledCheck: true}
	if err := o.applyDefaults(); err != nil {
		t.Fatalf("SkipStalledCheck: unexpected error: %v", err)
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

func TestConstructorsRequireABackend(t *testing.T) {
	proc := func(context.Context, *Job) (any, error) { return nil, nil }
	_, qErr := NewQueue("q", nil)
	_, wErr := NewWorker("q", proc, nil)
	_, eErr := NewQueueEvents("q", nil)
	for name, err := range map[string]error{"NewQueue": qErr, "NewWorker": wErr, "NewQueueEvents": eErr} {
		var ce *ConfigError
		if !errors.As(err, &ce) || !strings.Contains(ce.Message, "Backend is required") {
			t.Errorf("%s without a Backend: err = %v, want a ConfigError", name, err)
		}
	}
}

func TestConstructorsValidateTheQueueNameBeforeBuildingTheBackend(t *testing.T) {
	built := false
	factory := func(string, BackendOptions) (Backend, error) {
		built = true
		return stubBackend{}, nil
	}
	for _, name := range []string{"", "with:colon"} {
		_, err := NewQueue(name, &QueueOptions{Backend: factory})
		var ce *ConfigError
		if !errors.As(err, &ce) {
			t.Errorf("NewQueue(%q): err = %v, want a ConfigError", name, err)
		}
	}
	if built {
		t.Error("the backend was built for an invalid queue name")
	}
}
