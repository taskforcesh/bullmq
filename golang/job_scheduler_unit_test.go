package bullmq

import (
	"context"
	"errors"
	"io"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

func newSchedulerStubWorker(t *testing.T, stub *schedulerStub, proc Processor) (*Worker, func() []error) {
	t.Helper()
	var mu sync.Mutex
	var errs []error
	if proc == nil {
		proc = func(context.Context, *Job) (any, error) { return nil, nil }
	}
	w, err := NewWorker("sched", proc, &WorkerOptions{
		Backend: func(string, BackendOptions) (Backend, error) { return stub, nil },
		OnEvent: func(ev Event) {
			if ev.Type == EventError {
				mu.Lock()
				errs = append(errs, ev.Err)
				mu.Unlock()
			}
		},
	})
	if err != nil {
		t.Fatalf("NewWorker: %v", err)
	}
	t.Cleanup(func() { _ = w.Close() })
	return w, func() []error {
		mu.Lock()
		defer mu.Unlock()
		return append([]error(nil), errs...)
	}
}

// schedulerJob is a job of the iteration of scheduler sid due at millis.
func schedulerJob(sid string, millis int64, repeat *RepeatOptions) *Job {
	id := schedulerJobID(sid, millis)
	return &Job{
		ID:           id,
		Name:         "tick",
		Data:         []byte(`{"n":1}`),
		RepeatJobKey: sid,
		Opts: &JobOptions{
			JobID: id, Repeat: repeat, PrevMillis: millis, RepeatJobKey: sid,
			Attempts: Int64(2), Timestamp: 1,
		},
	}
}

func TestUpsertJobSchedulerPatternIteration(t *testing.T) {
	stub := &schedulerStub{}
	q := &Queue{backend: stub, defaultJobOptions: &JobOptions{Attempts: Int64(3), Delay: Int64(500)}}
	tokyo, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		t.Skip(err)
	}
	before := nowMillis()
	job, err := q.UpsertJobScheduler(context.Background(), "sid",
		RepeatOptions{Pattern: "0 0 9 * * *", Tz: "Asia/Tokyo", Limit: 5, Count: 7, Offset: 100},
		&JobTemplate{Name: "n", Data: map[string]int{"a": 1}})
	after := nowMillis()
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().In(tokyo)
	want := time.Date(now.Year(), now.Month(), now.Day(), 9, 0, 0, 0, tokyo)
	if !want.After(now) {
		want = want.AddDate(0, 0, 1)
	}

	added, _, _ := stub.recorded()
	if len(added) != 1 {
		t.Fatalf("AddJobScheduler called %d times", len(added))
	}
	s := added[0]
	if s.ID != "sid" || s.NextMillis != want.UnixMilli() || s.Name != "n" || s.Pattern != "0 0 9 * * *" ||
		s.Tz != "Asia/Tokyo" || s.Limit != 5 || s.Offset != 0 || string(s.TemplateData) != `{"a":1}` || s.ProducerID != "" {
		t.Fatalf("scheduler = %+v, want the next 09:00 in Tokyo (%d) and no offset", s, want.UnixMilli())
	}
	if s.TemplateOpts.Delay != nil || s.TemplateOpts.Repeat != nil || *s.TemplateOpts.Attempts != 3 {
		t.Fatalf("template options = %+v", s.TemplateOpts)
	}
	o := s.JobOpts
	if o.JobID != "repeat:sid:"+itoa(want.UnixMilli()) || o.PrevMillis != want.UnixMilli() || o.RepeatJobKey != "sid" ||
		o.Timestamp < before || o.Timestamp > after || *o.Attempts != 3 {
		t.Fatalf("job options = %+v", o)
	}
	if d := *o.Delay; d < want.UnixMilli()-after || d > want.UnixMilli()-before {
		t.Fatalf("job delay = %d, want the time until %d", d, want.UnixMilli())
	}
	if r := o.Repeat; r == nil || *r != (RepeatOptions{Pattern: "0 0 9 * * *", Tz: "Asia/Tokyo", Limit: 5, Count: 1}) {
		t.Fatalf("job repeat options = %+v", o.Repeat)
	}
	if job.ID != o.JobID || job.Delay != *o.Delay || job.RepeatJobKey != "sid" || job.Name != "n" {
		t.Fatalf("returned job = %+v", job)
	}
}

func TestUpsertJobSchedulerEveryIteration(t *testing.T) {
	stub := &schedulerStub{}
	q := &Queue{backend: stub}
	if _, err := q.UpsertJobScheduler(context.Background(), "e", RepeatOptions{Every: 1000, Offset: 300, Immediately: true}, nil); err != nil {
		t.Fatal(err)
	}
	added, _, _ := stub.recorded()
	s := added[0]
	// The backend computes the due time of an Every scheduler.
	if s.NextMillis != 0 || s.Every != 1000 || s.Offset != 300 || s.Name != "e" || string(s.TemplateData) != "{}" {
		t.Fatalf("scheduler = %+v", s)
	}
	o := s.JobOpts
	if o.JobID != "" || o.Delay != nil || o.PrevMillis != 0 ||
		*o.Repeat != (RepeatOptions{Every: 1000, Offset: 300, Count: 1}) {
		t.Fatalf("job options = %+v, repeat %+v", o, o.Repeat)
	}
}

func TestUpsertJobSchedulerValidation(t *testing.T) {
	q := &Queue{backend: &schedulerStub{}}
	ctx := context.Background()
	for name, c := range map[string]struct {
		id       string
		repeat   RepeatOptions
		template *JobTemplate
	}{
		"no id":                     {"", RepeatOptions{Every: 1}, nil},
		"pattern and every":         {"s", RepeatOptions{Every: 1, Pattern: "* * * * *"}, nil},
		"neither pattern nor every": {"s", RepeatOptions{}, nil},
		"immediately and start":     {"s", RepeatOptions{Pattern: "* * * * *", Immediately: true, StartDate: nowMillis() + 1000}, nil},
		"negative every":            {"s", RepeatOptions{Every: -1}, nil},
		"end date in the past":      {"s", RepeatOptions{Every: 1, EndDate: nowMillis() - 1000}, nil},
		"invalid pattern":           {"s", RepeatOptions{Pattern: "0 0 L-2 * *"}, nil},
		"invalid time zone":         {"s", RepeatOptions{Pattern: "* * * * *", Tz: "Nowhere/Land"}, nil},
		"template job id":           {"s", RepeatOptions{Every: 1}, &JobTemplate{Opts: &JobOptions{JobID: "x"}}},
		"template delay":            {"s", RepeatOptions{Every: 1}, &JobTemplate{Opts: &JobOptions{Delay: Int64(1)}}},
		"template deduplication":    {"s", RepeatOptions{Every: 1}, &JobTemplate{Opts: &JobOptions{Deduplication: &DeduplicationOptions{ID: "d"}}}},
	} {
		_, err := q.UpsertJobScheduler(ctx, c.id, c.repeat, c.template)
		var cfg *ConfigError
		if !errors.As(err, &cfg) {
			t.Errorf("%s: err = %v, want a ConfigError", name, err)
		}
	}
}

func TestAddRejectsRepeatOption(t *testing.T) {
	q := &Queue{backend: stubBackend{}}
	_, err := q.Add(context.Background(), "job", nil, &JobOptions{Repeat: &RepeatOptions{Every: 1000}})
	var cfg *ConfigError
	if !errors.As(err, &cfg) || !strings.Contains(err.Error(), "UpsertJobScheduler") {
		t.Fatalf("err = %v, want a ConfigError pointing to UpsertJobScheduler", err)
	}
}

func TestScheduleNextIterationAdvancesPatternScheduler(t *testing.T) {
	stub := &schedulerStub{}
	w, errs := newSchedulerStubWorker(t, stub, nil)
	// An iteration due in the future: the next one follows it, not now.
	millis := (nowMillis()/5000 + 12) * 5000
	job := schedulerJob("sid", millis, &RepeatOptions{Pattern: "*/5 * * * * *", Tz: "UTC", Count: 2})
	if !w.scheduleNextIteration(context.Background(), job) {
		t.Fatalf("scheduling failed: %v", errs())
	}
	_, updates, checked := stub.recorded()
	if len(updates) != 1 || len(checked) != 0 {
		t.Fatalf("updates %+v, IsJobScheduler calls %v; want one update and no check", updates, checked)
	}
	u := updates[0]
	next := millis + 5000
	if u.id != "sid" || u.nextMillis != next || u.producerID != job.ID || u.data != `{"n":1}` {
		t.Fatalf("update = %+v, want the iteration at %d produced by %s", u, next, job.ID)
	}
	o := u.jobOpts
	if o.JobID != schedulerJobID("sid", next) || o.PrevMillis != next || o.Repeat.Count != 3 || *o.Attempts != 2 {
		t.Fatalf("job options = %+v, repeat %+v", o, o.Repeat)
	}
	if len(errs()) != 0 {
		t.Fatalf("errors: %v", errs())
	}
}

func TestScheduleNextIterationStopsAtLimit(t *testing.T) {
	stub := &schedulerStub{}
	w, errs := newSchedulerStubWorker(t, stub, nil)
	job := schedulerJob("sid", nowMillis(), &RepeatOptions{Every: 1000, Limit: 3, Count: 3})
	if !w.scheduleNextIteration(context.Background(), job) {
		t.Fatalf("scheduling failed: %v", errs())
	}
	if _, updates, _ := stub.recorded(); len(updates) != 0 {
		t.Fatalf("updates %+v after the last iteration", updates)
	}
}

func TestScheduleNextIterationLegacyRepeatableJob(t *testing.T) {
	const legacy = "legacy-name:legacy-id:::*/5 * * * * *"

	// Not a scheduler: the job is processed, and the error reported.
	stub := &schedulerStub{}
	w, errs := newSchedulerStubWorker(t, stub, nil)
	job := schedulerJob(legacy, nowMillis(), &RepeatOptions{Pattern: "*/5 * * * * *"})
	if !w.scheduleNextIteration(context.Background(), job) {
		t.Fatal("a legacy repeatable job must still be processed")
	}
	_, updates, checked := stub.recorded()
	if len(updates) != 0 || len(checked) != 1 || checked[0] != legacy {
		t.Fatalf("updates %+v, checks %v", updates, checked)
	}
	waitForCondition(t, func() bool { return len(errs()) == 1 })
	if err := errs()[0]; !errors.Is(err, ErrLegacyRepeatableJob) || !strings.Contains(err.Error(), "migrate-from-v5-to-v6") {
		t.Fatalf("error = %v, want the legacy migration error", err)
	}

	// A scheduler whose id looks like a legacy key is advanced.
	stub = &schedulerStub{isScheduler: true}
	w, errs = newSchedulerStubWorker(t, stub, nil)
	if !w.scheduleNextIteration(context.Background(), job) {
		t.Fatalf("scheduling failed: %v", errs())
	}
	if _, updates, _ := stub.recorded(); len(updates) != 1 {
		t.Fatalf("updates %+v, want one", updates)
	}
}

func TestScheduleNextIterationRetriesTransientErrors(t *testing.T) {
	old := transitionRetryDelay
	transitionRetryDelay = time.Millisecond
	t.Cleanup(func() { transitionRetryDelay = old })

	stub := &schedulerStub{updateErrs: []error{io.EOF, io.EOF}}
	w, errs := newSchedulerStubWorker(t, stub, nil)
	job := schedulerJob("sid", nowMillis(), &RepeatOptions{Every: 1000})
	if !w.scheduleNextIteration(context.Background(), job) {
		t.Fatalf("scheduling failed: %v", errs())
	}
	if _, updates, _ := stub.recorded(); len(updates) != 1 {
		t.Fatalf("updates %+v, want one after the retries", updates)
	}
}

// As in Node.js, a job whose next iteration could not be scheduled is not
// processed: it stays active for the stalled check to retry it, and the
// scheduling with it, instead of silently ending the schedule.
func TestProcessJobLeavesJobActiveWhenSchedulingFails(t *testing.T) {
	boom := errors.New("boom")
	stub := &schedulerStub{updateErrs: []error{boom}}
	processed := false
	w, errs := newSchedulerStubWorker(t, stub, func(context.Context, *Job) (any, error) {
		processed = true
		return nil, nil
	})
	job := schedulerJob("sid", nowMillis(), &RepeatOptions{Every: 1000})
	job.worker, job.backend, job.token = w, stub, "token"
	if !w.beginJob() {
		t.Fatal("beginJob")
	}
	next := w.processJob(context.Background(), job)
	if processed || next.res != nil || next.refetch {
		t.Fatalf("processed = %v, next = %+v; want the job left unprocessed", processed, next)
	}
	waitForCondition(t, func() bool { return len(errs()) == 1 })
	if err := errs()[0]; !errors.Is(err, boom) || !strings.Contains(err.Error(), "next iteration") {
		t.Fatalf("error = %v", err)
	}
	if n := w.ActiveCount(); n != 0 {
		t.Fatalf("ActiveCount = %d, want the job no longer tracked", n)
	}
}

func TestHasLegacyRepeatableKeyShape(t *testing.T) {
	for key, want := range map[string]bool{
		"legacy-name:legacy-id:::*/5 * * * * *":         true,
		"legacy-name:legacy-id:::1000":                  true,
		"name:id:1700000000000:Europe/Madrid:0 9 * * *": true,
		"tenant:region:service:job:non-legacy":          false,
		"tenant:region:service:job:1000":                false,
		"tenant:region:env:service:queue:task":          false,
		"a:b:c":                                         false,
		"name:id:::":                                    false,
		"plain":                                         false,
	} {
		if got := hasLegacyRepeatableKeyShape(key); got != want {
			t.Errorf("hasLegacyRepeatableKeyShape(%q) = %v, want %v", key, got, want)
		}
	}
}

func TestRepeatOptionsDecodesOtherRuntimes(t *testing.T) {
	var r RepeatOptions
	err := r.UnmarshalJSON([]byte(`{"pattern":"* * * * *","every":null,"limit":"5","offset":250.0,
		"startDate":"2026-01-01T00:00:00.000Z","endDate":1767225600000,"tz":"UTC","count":3,"key":"x"}`))
	if err != nil {
		t.Fatal(err)
	}
	want := RepeatOptions{Pattern: "* * * * *", Limit: 5, Offset: 250, StartDate: 1767225600000, EndDate: 1767225600000, Tz: "UTC", Count: 3}
	if r != want {
		t.Fatalf("decoded %+v, want %+v", r, want)
	}
}

func waitForCondition(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met in time")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
