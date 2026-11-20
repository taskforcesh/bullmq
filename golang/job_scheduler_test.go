package bullmq_test

import (
	"context"
	"errors"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	bullmq "github.com/taskforcesh/bullmq-go"
	"github.com/taskforcesh/bullmq-go/internal/testbackends"
	"github.com/taskforcesh/bullmq-go/redisbackend"
)

// schedulerMillis returns the due time embedded in the id of a job produced
// by job scheduler sid: `repeat:<sid>:<millis>`.
func schedulerMillis(t *testing.T, sid, jobID string) int64 {
	t.Helper()
	rest, ok := strings.CutPrefix(jobID, "repeat:"+sid+":")
	if !ok {
		t.Fatalf("job id %q is not an iteration of scheduler %q", jobID, sid)
	}
	millis, err := strconv.ParseInt(rest, 10, 64)
	if err != nil {
		t.Fatalf("job id %q: %v", jobID, err)
	}
	return millis
}

func upsertScheduler(t *testing.T, ctx context.Context, q *bullmq.Queue, id string, repeat bullmq.RepeatOptions, template *bullmq.JobTemplate) *bullmq.Job {
	t.Helper()
	job, err := q.UpsertJobScheduler(ctx, id, repeat, template)
	if err != nil {
		t.Fatalf("UpsertJobScheduler(%s): %v", id, err)
	}
	if job == nil {
		t.Fatalf("UpsertJobScheduler(%s) produced no job", id)
	}
	return job
}

func requireScheduler(t *testing.T, ctx context.Context, q *bullmq.Queue, id string) *bullmq.JobScheduler {
	t.Helper()
	s, err := q.JobScheduler(ctx, id)
	if err != nil || s == nil {
		t.Fatalf("JobScheduler(%s) = %v, %v; want the scheduler", id, s, err)
	}
	return s
}

// processedIDs records the ids of the jobs a worker processes.
type processedIDs struct {
	mu  sync.Mutex
	ids []string
}

func (p *processedIDs) record(job *bullmq.Job) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.ids = append(p.ids, job.ID)
}

func (p *processedIDs) snapshot() []string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return slices.Clone(p.ids)
}

// runRecordingWorker starts a worker on q that records the jobs it
// processes.
func runRecordingWorker(t *testing.T, be testBackend, q *bullmq.Queue, opts *bullmq.WorkerOptions) *processedIDs {
	t.Helper()
	p := &processedIDs{}
	w := newTestWorker(t, be, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
		p.record(job)
		return nil, nil
	}, opts)
	runWorker(t, w)
	return p
}

func pendingSchedulerJobs(t *testing.T, ctx context.Context, q *bullmq.Queue) []string {
	t.Helper()
	var ids []string
	for _, state := range []bullmq.JobState{bullmq.StateDelayed, bullmq.StateWaiting, bullmq.StatePrioritized} {
		got, err := q.JobIDs(ctx, state, 0, -1, true)
		if err != nil {
			t.Fatalf("JobIDs(%s): %v", state, err)
		}
		ids = append(ids, got...)
	}
	return ids
}

func TestJobSchedulerPatternProducesIterations(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		q := newTestQueue(t, be, nil)
		before := time.Now().UnixMilli()
		first := upsertScheduler(t, ctx, q, "every-second",
			bullmq.RepeatOptions{Pattern: "* * * * * *", Tz: "UTC"},
			&bullmq.JobTemplate{Name: "tick", Data: map[string]int{"n": 1}, Opts: &bullmq.JobOptions{Attempts: bullmq.Int64(2)}})
		millis := schedulerMillis(t, "every-second", first.ID)
		if millis%1000 != 0 || millis <= before-1000 || millis > before+1000 {
			t.Fatalf("first iteration due at %d, want the next whole second after %d", millis, before)
		}
		if first.Name != "tick" || first.RepeatJobKey != "every-second" {
			t.Fatalf("first job = %+v", first)
		}

		var mu sync.Mutex
		var jobs []*bullmq.Job
		w := newTestWorker(t, be, q.Name(), func(_ context.Context, job *bullmq.Job) (any, error) {
			mu.Lock()
			jobs = append(jobs, job)
			mu.Unlock()
			return nil, nil
		}, nil)
		runWorker(t, w)
		waitFor(t, 15*time.Second, "3 iterations", func() bool {
			mu.Lock()
			defer mu.Unlock()
			return len(jobs) >= 3
		})

		mu.Lock()
		got := slices.Clone(jobs)
		mu.Unlock()
		prev := int64(0)
		for i, job := range got {
			m := schedulerMillis(t, "every-second", job.ID)
			if m%1000 != 0 || m <= prev {
				t.Fatalf("iteration %d due at %d after %d", i, m, prev)
			}
			prev = m
			var data map[string]int
			if err := job.DecodeData(&data); err != nil || data["n"] != 1 || job.Name != "tick" {
				t.Fatalf("iteration %d = %s %s, want the template", i, job.Name, job.Data)
			}
			if job.Opts.Repeat == nil || job.Opts.Repeat.Count != int64(i+1) || job.Opts.Repeat.Pattern != "* * * * * *" {
				t.Fatalf("iteration %d repeat options = %+v", i, job.Opts.Repeat)
			}
			if job.Opts.PrevMillis != m || job.Opts.Attempts == nil || *job.Opts.Attempts != 2 {
				t.Fatalf("iteration %d options = %+v", i, job.Opts)
			}
		}

		s := requireScheduler(t, ctx, q, "every-second")
		if s.Name != "tick" || s.Pattern != "* * * * * *" || s.Tz != "UTC" || s.IterationCount < int64(len(got)) {
			t.Fatalf("scheduler = %+v", s)
		}
		if s.Template == nil || string(s.Template.Data) != `{"n":1}` || s.Template.Opts == nil ||
			s.Template.Opts.Attempts == nil || *s.Template.Opts.Attempts != 2 {
			t.Fatalf("scheduler template = %+v", s.Template)
		}
	})
}

func TestJobSchedulerEveryWithOffset(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		q := newTestQueue(t, be, nil)
		const every, offset = 700, 250
		before := time.Now().UnixMilli()
		first := upsertScheduler(t, ctx, q, "offset", bullmq.RepeatOptions{Every: every, Offset: offset}, nil)
		millis := schedulerMillis(t, "offset", first.ID)
		if millis%every != offset || millis <= before || millis > before+every+offset {
			t.Fatalf("first iteration due at %d (now %d), want the next slot at offset %d", millis, before, offset)
		}
		if s := requireScheduler(t, ctx, q, "offset"); s.Every != every || s.Offset != offset || s.Next != millis {
			t.Fatalf("scheduler = %+v", s)
		}

		p := runRecordingWorker(t, be, q, nil)
		waitFor(t, 15*time.Second, "3 iterations", func() bool { return len(p.snapshot()) >= 3 })
		prev := int64(0)
		for _, id := range p.snapshot() {
			m := schedulerMillis(t, "offset", id)
			if m%every != offset || m <= prev {
				t.Fatalf("iterations %v are not at offset %d of %dms slots", p.snapshot(), offset, every)
			}
			prev = m
		}
	})
}

func TestJobSchedulerEveryWithoutOffsetStartsNow(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		q := newTestQueue(t, be, nil)
		const every = 60_000
		before := time.Now().UnixMilli()
		first := upsertScheduler(t, ctx, q, "now", bullmq.RepeatOptions{Every: every}, nil)
		millis := schedulerMillis(t, "now", first.ID)
		if millis < before || millis > time.Now().UnixMilli() || first.Delay != 0 {
			t.Fatalf("first iteration due at %d with delay %d, want now (%d)", millis, first.Delay, before)
		}
		if s := requireScheduler(t, ctx, q, "now"); s.Offset != millis%every {
			t.Fatalf("scheduler offset = %d, want %d", s.Offset, millis%every)
		}

		p := runRecordingWorker(t, be, q, nil)
		waitFor(t, 10*time.Second, "the first iteration", func() bool { return len(p.snapshot()) == 1 })
		waitFor(t, 10*time.Second, "the second iteration", func() bool {
			return slices.Contains(pendingSchedulerJobs(t, ctx, q), "repeat:now:"+strconv.FormatInt(millis+every, 10))
		})
	})
}

func TestJobSchedulerLimit(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		q := newTestQueue(t, be, nil)
		upsertScheduler(t, ctx, q, "limited", bullmq.RepeatOptions{Every: 100, Limit: 3}, nil)
		p := runRecordingWorker(t, be, q, nil)
		waitFor(t, 10*time.Second, "3 iterations", func() bool { return len(p.snapshot()) >= 3 })
		time.Sleep(500 * time.Millisecond)
		if got := p.snapshot(); len(got) != 3 {
			t.Fatalf("processed %v, want exactly 3 iterations", got)
		}
		if pending := pendingSchedulerJobs(t, ctx, q); len(pending) != 0 {
			t.Fatalf("pending jobs %v after the limit", pending)
		}
		if s := requireScheduler(t, ctx, q, "limited"); s.IterationCount != 3 || s.Limit != 3 {
			t.Fatalf("scheduler = %+v", s)
		}
	})
}

func TestJobSchedulerStartDate(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		q := newTestQueue(t, be, nil)
		start := time.Now().Add(time.Hour).UnixMilli()

		job := upsertScheduler(t, ctx, q, "every", bullmq.RepeatOptions{Every: 1000, StartDate: start}, nil)
		if got := schedulerMillis(t, "every", job.ID); got != start {
			t.Fatalf("every scheduler starts at %d, want the start date %d", got, start)
		}
		job = upsertScheduler(t, ctx, q, "pattern", bullmq.RepeatOptions{Pattern: "*/10 * * * * *", StartDate: start, Tz: "UTC"}, nil)
		if got := schedulerMillis(t, "pattern", job.ID); got <= start || got > start+10_000 || got%10_000 != 0 {
			t.Fatalf("pattern scheduler starts at %d, want the first match after %d", got, start)
		}
		if s := requireScheduler(t, ctx, q, "pattern"); s.StartDate != start {
			t.Fatalf("scheduler start date = %d, want %d", s.StartDate, start)
		}
	})
}

func TestJobSchedulerEndDate(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		q := newTestQueue(t, be, nil)

		_, err := q.UpsertJobScheduler(ctx, "past", bullmq.RepeatOptions{Every: 1000, EndDate: time.Now().Add(-time.Second).UnixMilli()}, nil)
		var cfg *bullmq.ConfigError
		if !errors.As(err, &cfg) {
			t.Fatalf("end date in the past: err = %v, want a ConfigError", err)
		}

		// No run of the pattern before the end date: nothing is created.
		job, err := q.UpsertJobScheduler(ctx, "never", bullmq.RepeatOptions{
			Pattern: "0 0 0 1 1 *", Tz: "UTC", EndDate: time.Now().Add(time.Minute).UnixMilli(),
		}, nil)
		if err != nil || job != nil {
			t.Fatalf("UpsertJobScheduler(never) = %v, %v; want no job", job, err)
		}
		if n, err := q.JobSchedulersCount(ctx); err != nil || n != 0 {
			t.Fatalf("JobSchedulersCount = %d, %v; want 0", n, err)
		}

		end := time.Now().Add(1500 * time.Millisecond).UnixMilli()
		upsertScheduler(t, ctx, q, "ending", bullmq.RepeatOptions{Pattern: "*/1 * * * * *", Tz: "UTC", EndDate: end}, nil)
		p := runRecordingWorker(t, be, q, nil)
		waitFor(t, 10*time.Second, "the schedule to end", func() bool {
			return time.Now().UnixMilli() > end && len(pendingSchedulerJobs(t, ctx, q)) == 0
		})
		got := p.snapshot()
		if len(got) == 0 {
			t.Fatal("no iteration was processed before the end date")
		}
		for _, id := range got {
			if m := schedulerMillis(t, "ending", id); m > end {
				t.Fatalf("iteration %s is due after the end date %d", id, end)
			}
		}
	})
}

func TestJobSchedulerImmediately(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		q := newTestQueue(t, be, nil)
		before := time.Now().UnixMilli()
		job := upsertScheduler(t, ctx, q, "yearly", bullmq.RepeatOptions{Pattern: "0 0 0 1 1 *", Tz: "UTC", Immediately: true}, nil)
		if m := schedulerMillis(t, "yearly", job.ID); m < before || m > time.Now().UnixMilli() || job.Delay != 0 {
			t.Fatalf("first iteration due at %d with delay %d, want now", m, job.Delay)
		}

		p := runRecordingWorker(t, be, q, nil)
		waitFor(t, 10*time.Second, "the immediate iteration", func() bool { return len(p.snapshot()) == 1 })
		now := time.Now().UTC()
		nextYear := time.Date(now.Year()+1, 1, 1, 0, 0, 0, 0, time.UTC).UnixMilli()
		want := "repeat:yearly:" + strconv.FormatInt(nextYear, 10)
		waitFor(t, 10*time.Second, "the next iteration "+want, func() bool {
			return slices.Equal(pendingSchedulerJobs(t, ctx, q), []string{want})
		})
	})
}

func TestJobSchedulerUpsertOverrides(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		q := newTestQueue(t, be, nil)
		first := upsertScheduler(t, ctx, q, "s", bullmq.RepeatOptions{Pattern: "0 0 0 1 1 *", Tz: "UTC"},
			&bullmq.JobTemplate{Name: "a", Data: "A"})

		// The same schedule keeps the same iteration.
		again := upsertScheduler(t, ctx, q, "s", bullmq.RepeatOptions{Pattern: "0 0 0 1 1 *", Tz: "UTC"},
			&bullmq.JobTemplate{Name: "a", Data: "A2"})
		if again.ID != first.ID {
			t.Fatalf("upserting the same schedule moved the iteration from %s to %s", first.ID, again.ID)
		}
		requireStoredData(t, ctx, q, again.ID, `"A2"`)

		// A new schedule replaces the pending iteration.
		second := upsertScheduler(t, ctx, q, "s", bullmq.RepeatOptions{Pattern: "0 0 0 1 7 *", Tz: "UTC"},
			&bullmq.JobTemplate{Name: "b", Data: "B"})
		if second.ID == first.ID {
			t.Fatalf("new schedule kept iteration %s", first.ID)
		}
		requireJobGone(t, ctx, q, first.ID)
		if pending := pendingSchedulerJobs(t, ctx, q); !slices.Equal(pending, []string{second.ID}) {
			t.Fatalf("pending jobs %v, want only %s", pending, second.ID)
		}
		s := requireScheduler(t, ctx, q, "s")
		if s.Pattern != "0 0 0 1 7 *" || s.Name != "b" || s.Template == nil || string(s.Template.Data) != `"B"` || s.IterationCount != 1 {
			t.Fatalf("scheduler = %+v, template %+v", s, s.Template)
		}
		if n, err := q.JobSchedulersCount(ctx); err != nil || n != 1 {
			t.Fatalf("JobSchedulersCount = %d, %v; want 1", n, err)
		}

		// Switching to an interval keeps a single pending iteration.
		every := upsertScheduler(t, ctx, q, "s", bullmq.RepeatOptions{Every: 3_600_000, StartDate: time.Now().Add(time.Hour).UnixMilli()}, nil)
		if pending := pendingSchedulerJobs(t, ctx, q); !slices.Equal(pending, []string{every.ID}) {
			t.Fatalf("pending jobs %v, want only %s", pending, every.ID)
		}
		if s := requireScheduler(t, ctx, q, "s"); s.Pattern != "" || s.Every != 3_600_000 || s.Template != nil {
			t.Fatalf("scheduler = %+v", s)
		}
	})
}

func TestJobSchedulerRemove(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		q := newTestQueue(t, be, nil)
		job := upsertScheduler(t, ctx, q, "gone", bullmq.RepeatOptions{Pattern: "0 0 0 1 1 *", Tz: "UTC"}, nil)

		removed, err := q.RemoveJobScheduler(ctx, "gone")
		if err != nil || !removed {
			t.Fatalf("RemoveJobScheduler = %v, %v; want true", removed, err)
		}
		requireJobGone(t, ctx, q, job.ID)
		if s, err := q.JobScheduler(ctx, "gone"); err != nil || s != nil {
			t.Fatalf("JobScheduler after remove = %+v, %v; want nil", s, err)
		}
		if n, err := q.JobSchedulersCount(ctx); err != nil || n != 0 {
			t.Fatalf("JobSchedulersCount = %d, %v; want 0", n, err)
		}
		if removed, err := q.RemoveJobScheduler(ctx, "gone"); err != nil || removed {
			t.Fatalf("second RemoveJobScheduler = %v, %v; want false", removed, err)
		}
	})
}

func TestJobSchedulerGettersAndPagination(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		q := newTestQueue(t, be, &bullmq.QueueOptions{DefaultJobOptions: &bullmq.JobOptions{Attempts: bullmq.Int64(3)}})
		base := time.Now().Add(time.Hour).UnixMilli()
		starts := map[string]int64{}
		for _, i := range []int{3, 1, 5, 2, 4} {
			id := "s" + strconv.Itoa(i)
			starts[id] = base + int64(i)*60_000
			upsertScheduler(t, ctx, q, id, bullmq.RepeatOptions{Every: 3_600_000, StartDate: starts[id], Limit: 10},
				&bullmq.JobTemplate{Name: "job-" + id, Data: map[string]string{"id": id}})
		}

		if n, err := q.JobSchedulersCount(ctx); err != nil || n != 5 {
			t.Fatalf("JobSchedulersCount = %d, %v; want 5", n, err)
		}
		ids := func(start, end int64, asc bool) []string {
			list, err := q.JobSchedulers(ctx, start, end, asc)
			if err != nil {
				t.Fatalf("JobSchedulers(%d, %d, %v): %v", start, end, asc, err)
			}
			out := make([]string, len(list))
			for i, s := range list {
				out[i] = s.ID
				if s.Next != starts[s.ID] {
					t.Fatalf("scheduler %s next = %d, want %d", s.ID, s.Next, starts[s.ID])
				}
			}
			return out
		}
		for _, c := range []struct {
			start, end int64
			asc        bool
			want       []string
		}{
			{0, -1, true, []string{"s1", "s2", "s3", "s4", "s5"}},
			{0, -1, false, []string{"s5", "s4", "s3", "s2", "s1"}},
			{0, 1, true, []string{"s1", "s2"}},
			{1, 2, false, []string{"s4", "s3"}},
			{4, 10, true, []string{"s5"}},
			{6, 8, true, []string{}},
		} {
			if got := ids(c.start, c.end, c.asc); !slices.Equal(got, c.want) {
				t.Errorf("JobSchedulers(%d, %d, %v) = %v, want %v", c.start, c.end, c.asc, got, c.want)
			}
		}

		s := requireScheduler(t, ctx, q, "s3")
		if s.Name != "job-s3" || s.Every != 3_600_000 || s.StartDate != starts["s3"] || s.Limit != 10 ||
			s.IterationCount != 1 || s.Next != starts["s3"] || s.EndDate != 0 || s.Tz != "" {
			t.Fatalf("scheduler = %+v", s)
		}
		if s.Template == nil || string(s.Template.Data) != `{"id":"s3"}` || s.Template.Opts == nil ||
			s.Template.Opts.Attempts == nil || *s.Template.Opts.Attempts != 3 {
			t.Fatalf("template = %+v", s.Template)
		}

		if s, err := q.JobScheduler(ctx, "missing"); err != nil || s != nil {
			t.Fatalf("JobScheduler(missing) = %+v, %v; want nil", s, err)
		}
		if _, err := q.JobScheduler(ctx, "name:id::UTC:0 * * * *"); !errors.Is(err, bullmq.ErrLegacyRepeatableJob) {
			t.Fatalf("JobScheduler(legacy key) error = %v, want ErrLegacyRepeatableJob", err)
		}
	})
}

// A worker advances the schedule iteration after iteration, without ever
// producing the same iteration twice, even with several workers.
func TestJobSchedulerWorkersKeepScheduleWithoutDuplicates(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		q := newTestQueue(t, be, nil)
		const every = 100
		upsertScheduler(t, ctx, q, "busy", bullmq.RepeatOptions{Every: every}, nil)

		var mu sync.Mutex
		var ids []string
		proc := func(_ context.Context, job *bullmq.Job) (any, error) {
			mu.Lock()
			ids = append(ids, job.ID)
			mu.Unlock()
			return nil, nil
		}
		for range 2 {
			runWorker(t, newTestWorker(t, be, q.Name(), proc, &bullmq.WorkerOptions{Concurrency: 2}))
		}
		const want = 20
		waitFor(t, 20*time.Second, "20 iterations", func() bool {
			mu.Lock()
			defer mu.Unlock()
			return len(ids) >= want
		})

		mu.Lock()
		got := slices.Clone(ids)
		mu.Unlock()
		millis := make([]int64, len(got))
		for i, id := range got {
			millis[i] = schedulerMillis(t, "busy", id)
		}
		slices.Sort(millis)
		for i := 1; i < len(millis); i++ {
			if millis[i]-millis[i-1] < every || (millis[i]-millis[0])%every != 0 {
				t.Fatalf("iterations %v are not distinct %dms slots", millis, every)
			}
		}
		if pending := pendingSchedulerJobs(t, ctx, q); len(pending) > 1 {
			t.Fatalf("pending iterations %v, want at most one", pending)
		}
		if s := requireScheduler(t, ctx, q, "busy"); s.IterationCount < int64(len(got)) {
			t.Fatalf("iteration count %d < %d processed", s.IterationCount, len(got))
		}
	})
}

func TestJobSchedulerTimeZones(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		q := newTestQueue(t, be, nil)
		for _, tz := range []string{"America/New_York", "Asia/Tokyo", "Europe/Madrid"} {
			loc, err := time.LoadLocation(tz)
			if err != nil {
				t.Skipf("time zone %s is not available: %v", tz, err)
			}
			id := "nine-" + tz
			job := upsertScheduler(t, ctx, q, id, bullmq.RepeatOptions{Pattern: "0 0 9 * * *", Tz: tz}, nil)
			now := time.Now().In(loc)
			want := time.Date(now.Year(), now.Month(), now.Day(), 9, 0, 0, 0, loc)
			if !want.After(now) {
				want = time.Date(now.Year(), now.Month(), now.Day()+1, 9, 0, 0, 0, loc)
			}
			if got := schedulerMillis(t, id, job.ID); got != want.UnixMilli() {
				t.Errorf("%s: next 09:00 is %s, want %s", tz, time.UnixMilli(got).In(loc), want)
			}
			if s := requireScheduler(t, ctx, q, id); s.Tz != tz {
				t.Errorf("scheduler tz = %q, want %q", s.Tz, tz)
			}
		}

		_, err := q.UpsertJobScheduler(ctx, "bad-tz", bullmq.RepeatOptions{Pattern: "0 9 * * *", Tz: "Mars/Olympus"}, nil)
		var cfg *bullmq.ConfigError
		if !errors.As(err, &cfg) {
			t.Fatalf("invalid time zone: err = %v, want a ConfigError", err)
		}
		_, err = q.UpsertJobScheduler(ctx, "bad-pattern", bullmq.RepeatOptions{Pattern: "0 0 15W * *"}, nil)
		if !errors.As(err, &cfg) || !strings.Contains(err.Error(), "Invalid characters") {
			t.Fatalf("W pattern: err = %v, want cron-parser's error", err)
		}
	})
}

// A scheduler id may look like a legacy repeatable key (issue #3828): the
// worker must still advance it, once per iteration.
func TestJobSchedulerIDShapedLikeLegacyKey(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		q := newTestQueue(t, be, nil)
		const id = "tenant:region:::300"
		upsertScheduler(t, ctx, q, id, bullmq.RepeatOptions{Every: 300}, nil)
		p := runRecordingWorker(t, be, q, nil)
		waitFor(t, 10*time.Second, "3 iterations", func() bool { return len(p.snapshot()) >= 3 })
		list, err := q.JobSchedulers(ctx, 0, -1, true)
		if err != nil || len(list) != 1 || list[0].ID != id {
			t.Fatalf("JobSchedulers = %+v, %v; want only %s", list, err, id)
		}
	})
}

// Legacy repeatable jobs and dangling scheduler entries can only be
// created by writing to Redis directly.
func TestJobSchedulersLegacyAndDanglingEntriesRedis(t *testing.T) {
	be := testbackends.Redis()
	be.Require(t)
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	rb := q.Backend().(*redisbackend.Backend)
	rdb, repeatKey := rb.Client(), rb.Keys().Repeat()
	next := float64(time.Now().Add(time.Minute).UnixMilli())

	for _, id := range []string{"tenant:region:service:job:non-legacy", "tenant:region:service:job:1000"} {
		if err := rdb.ZAdd(ctx, repeatKey, redis.Z{Score: next, Member: id}).Err(); err != nil {
			t.Fatal(err)
		}
		if list, err := q.JobSchedulers(ctx, 0, -1, true); err != nil || len(list) != 0 {
			t.Fatalf("JobSchedulers = %+v, %v; want the dangling %s skipped", list, err, id)
		}
		if n, err := q.JobSchedulersCount(ctx); err != nil || n != 0 {
			t.Fatalf("dangling %s was not removed: count %d, %v", id, n, err)
		}
	}

	const legacy = "legacy-name:legacy-id:::*/5 * * * * *"
	if err := rdb.ZAdd(ctx, repeatKey, redis.Z{Score: next, Member: legacy}).Err(); err != nil {
		t.Fatal(err)
	}
	if err := rdb.HSet(ctx, repeatKey+":"+legacy, "name", "legacy-name").Err(); err != nil {
		t.Fatal(err)
	}
	if ok, err := rb.IsJobScheduler(ctx, legacy); err != nil || ok {
		t.Fatalf("IsJobScheduler(legacy) = %v, %v; want false", ok, err)
	}
	if err := rdb.Del(ctx, repeatKey+":"+legacy).Err(); err != nil {
		t.Fatal(err)
	}
	if _, err := q.JobSchedulers(ctx, 0, -1, true); !errors.Is(err, bullmq.ErrLegacyRepeatableJob) {
		t.Fatalf("JobSchedulers with a legacy entry: err = %v, want ErrLegacyRepeatableJob", err)
	}
}

// addSchedulerAsNode stores a scheduler whose first iteration is due now,
// with its time zone written verbatim, as Node's upsertJobScheduler does.
func addSchedulerAsNode(t *testing.T, ctx context.Context, q *bullmq.Queue, id, pattern, tz string) string {
	t.Helper()
	now := time.Now().UnixMilli()
	jobID := "repeat:" + id + ":" + strconv.FormatInt(now, 10)
	_, _, err := q.Backend().AddJobScheduler(ctx, bullmq.NewJobScheduler{
		ID: id, NextMillis: now, Name: "tick", Pattern: pattern, Tz: tz,
		TemplateData: []byte("{}"), TemplateOpts: &bullmq.JobOptions{},
		JobOpts: &bullmq.JobOptions{
			JobID: jobID, Delay: bullmq.Int64(0), Timestamp: now, PrevMillis: now, RepeatJobKey: id,
			Repeat: &bullmq.RepeatOptions{Pattern: pattern, Tz: tz, Count: 1},
		},
	})
	if err != nil {
		t.Fatalf("AddJobScheduler(%s): %v", id, err)
	}
	return jobID
}

// errorRecorder collects the error events of a worker.
type errorRecorder struct {
	mu   sync.Mutex
	errs []error
}

func (r *errorRecorder) onEvent(ev bullmq.Event) {
	if ev.Type == bullmq.EventError {
		r.mu.Lock()
		r.errs = append(r.errs, ev.Err)
		r.mu.Unlock()
	}
}

func (r *errorRecorder) all() []error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Clone(r.errs)
}

// Node.js accepts time zones in any case, ICU's legacy ids and offsets; a Go
// worker must advance schedulers stored with them, to the same runs.
func TestJobSchedulerAdvancesNodeTimeZoneForms(t *testing.T) {
	forEachBackend(t, func(t *testing.T, be testBackend) {
		ctx := testContext(t)
		q := newTestQueue(t, be, nil)
		zones := map[string]*time.Location{
			"america/new_york": mustLoad(t, "America/New_York"),
			"us/eastern":       mustLoad(t, "America/New_York"),
			"Europe/london":    mustLoad(t, "Europe/London"),
			"pst":              mustLoad(t, "America/Los_Angeles"),
			"+03:00":           time.FixedZone("+03:00", 3*3600),
			"-0530":            time.FixedZone("-05:30", -(5*3600 + 30*60)),
			"UTC+05:30":        time.FixedZone("UTC+05:30", 5*3600+30*60),
		}
		first := map[string]string{}
		for tz := range zones {
			first[tz] = addSchedulerAsNode(t, ctx, q, "noon "+tz, "0 0 12 * * *", tz)
		}

		var errs errorRecorder
		p := runRecordingWorker(t, be, q, &bullmq.WorkerOptions{OnEvent: errs.onEvent})
		waitFor(t, 10*time.Second, "the first iterations", func() bool { return len(p.snapshot()) == len(zones) })
		waitFor(t, 10*time.Second, "the next iterations", func() bool { return len(pendingSchedulerJobs(t, ctx, q)) == len(zones) })

		now := time.Now()
		pending := pendingSchedulerJobs(t, ctx, q)
		for tz, loc := range zones {
			local := now.In(loc)
			want := time.Date(local.Year(), local.Month(), local.Day(), 12, 0, 0, 0, loc)
			if !want.After(now) {
				want = time.Date(local.Year(), local.Month(), local.Day()+1, 12, 0, 0, 0, loc)
			}
			wantID := "repeat:noon " + tz + ":" + strconv.FormatInt(want.UnixMilli(), 10)
			if !slices.Contains(pending, wantID) {
				t.Errorf("tz %q: pending iterations %v, want %s (noon %s)", tz, pending, wantID, want)
			}
		}
		if got := errs.all(); len(got) != 0 {
			t.Fatalf("error events: %v", got)
		}
	})
}

func mustLoad(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Skipf("time zone %s is not available: %v", name, err)
	}
	return loc
}
