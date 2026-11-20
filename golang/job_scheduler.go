package bullmq

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/taskforcesh/bullmq-go/internal/cronparity"
)

// RepeatOptions describe the schedule of a job scheduler, as Node's
// RepeatOptions do. Exactly one of Pattern and Every must be set.
//
// The JSON form is the one every BullMQ port stores in the options of the
// jobs a scheduler produces (`opts.repeat`), with times in Unix milliseconds.
type RepeatOptions struct {
	// Pattern is a cron expression with 5 fields, or 6 with leading seconds,
	// evaluated like cron-parser does in Node.js, in time zone Tz.
	Pattern string `json:"pattern,omitempty"`
	// Every repeats the job every this many milliseconds.
	Every int64 `json:"every,omitempty"`
	// Limit is the maximum number of jobs the scheduler produces. 0 means no
	// limit.
	Limit int64 `json:"limit,omitempty"`
	// Immediately makes a Pattern scheduler produce its first job right away
	// instead of at the first time matching the pattern. Every schedulers
	// always produce their first job right away (or at StartDate).
	Immediately bool `json:"immediately,omitempty"`
	// Offset shifts the runs of an Every scheduler, in milliseconds.
	Offset int64 `json:"offset,omitempty"`
	// StartDate is when the schedule starts, in Unix milliseconds. 0 means
	// now.
	StartDate int64 `json:"startDate,omitempty"`
	// EndDate is when the schedule ends, in Unix milliseconds. 0 means
	// never.
	EndDate int64 `json:"endDate,omitempty"`
	// Tz is the IANA time zone Pattern is evaluated in. Empty means the
	// local time zone of the process, as in Node.js. Time zones are read
	// from the system's time zone database; programs running where there
	// is none can embed one with `import _ "time/tzdata"`.
	Tz string `json:"tz,omitempty"`
	// Count is the iteration of the job it is stored in. It is maintained
	// by the scheduler and ignored by Queue.UpsertJobScheduler.
	Count int64 `json:"count,omitempty"`
}

// UnmarshalJSON decodes repeat options written by any BullMQ port, accepting
// numbers written as floats or strings, and dates written as ISO 8601 strings.
func (r *RepeatOptions) UnmarshalJSON(data []byte) error {
	var raw struct {
		Pattern     *string         `json:"pattern"`
		Every       json.RawMessage `json:"every"`
		Limit       json.RawMessage `json:"limit"`
		Immediately *bool           `json:"immediately"`
		Offset      json.RawMessage `json:"offset"`
		StartDate   json.RawMessage `json:"startDate"`
		EndDate     json.RawMessage `json:"endDate"`
		Tz          *string         `json:"tz"`
		Count       json.RawMessage `json:"count"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*r = RepeatOptions{
		Every:     flexMillis(raw.Every, false),
		Limit:     flexMillis(raw.Limit, false),
		Offset:    flexMillis(raw.Offset, false),
		StartDate: flexMillis(raw.StartDate, true),
		EndDate:   flexMillis(raw.EndDate, true),
		Count:     flexMillis(raw.Count, false),
	}
	if raw.Pattern != nil {
		r.Pattern = *raw.Pattern
	}
	if raw.Immediately != nil {
		r.Immediately = *raw.Immediately
	}
	if raw.Tz != nil {
		r.Tz = *raw.Tz
	}
	return nil
}

// flexMillis decodes a number stored as a JSON number or string and, when
// date is set, an ISO 8601 date, returning 0 for anything else.
func flexMillis(raw json.RawMessage, date bool) int64 {
	if len(raw) == 0 {
		return 0
	}
	var f float64
	if json.Unmarshal(raw, &f) == nil {
		return int64(f)
	}
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return 0
	}
	if n := parseInt(s); n != 0 || s == "0" {
		return n
	}
	if date {
		for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05.999", "2006-01-02"} {
			if t, err := time.Parse(layout, s); err == nil {
				return t.UnixMilli()
			}
		}
	}
	return 0
}

// JobTemplate describes the jobs a job scheduler produces.
type JobTemplate struct {
	// Name is the name of every job. It defaults to the scheduler id.
	Name string
	// Data is the payload of every job; it is marshalled to JSON. Nil
	// means an empty object.
	Data any
	// Opts are the options of every job, merged over the queue's default
	// job options. JobID, Delay, Deduplication and Repeat cannot be set.
	Opts *JobOptions
}

// JobScheduler describes a stored job scheduler, as returned by
// Queue.JobScheduler and Queue.JobSchedulers. It mirrors Node's
// JobSchedulerJson; times are Unix milliseconds and zero values mean unset.
type JobScheduler struct {
	// ID is the scheduler id (Node's `key`).
	ID string
	// Name is the name of the jobs it produces.
	Name string
	// IterationCount is how many jobs it has produced.
	IterationCount int64
	Limit          int64
	StartDate      int64
	EndDate        int64
	Tz             string
	Pattern        string
	Every          int64
	Offset         int64
	// Next is when its next job is due.
	Next int64
	// Template holds the data and options of the jobs it produces, or nil
	// when it stores neither.
	Template *JobSchedulerTemplate
}

// JobSchedulerTemplate is the stored template of a job scheduler.
type JobSchedulerTemplate struct {
	// Data is the JSON payload, or nil when none is stored.
	Data json.RawMessage
	// Opts are the job options, or nil when none are stored.
	Opts *JobOptions
}

// NewJobScheduler is a job scheduler to store with [Backend.AddJobScheduler],
// with the options of the job of its next iteration. It mirrors the
// arguments of Node's addJobScheduler.
type NewJobScheduler struct {
	// ID identifies the scheduler.
	ID string
	// NextMillis is when the next iteration is due (Unix milliseconds). It
	// is ignored for Every schedulers, whose next iteration the backend
	// computes from Every, Offset and StartDate as the shared commands do.
	NextMillis int64
	// Name is the name of the jobs the scheduler produces.
	Name string
	// The schedule; zero values are not stored. Offset is only set for
	// Every schedulers.
	Pattern   string
	Every     int64
	Tz        string
	Limit     int64
	Offset    int64
	StartDate int64
	EndDate   int64
	// TemplateData is the JSON payload of every job.
	TemplateData []byte
	// TemplateOpts are the options of every job.
	TemplateOpts *JobOptions
	// JobOpts are the options of the job of the next iteration.
	JobOpts *JobOptions
	// ProducerID is the job that produced this iteration, if any.
	ProducerID string
}

// JobSchedulerNext is a scheduler id with the due time of its next job, as
// listed by [Backend.GetJobSchedulersRange].
type JobSchedulerNext struct {
	ID   string
	Next int64
}

// ErrLegacyRepeatableJob is returned for repeatable jobs created with the
// legacy repeat API (BullMQ v5 and earlier), which this port does not
// support. They must be migrated to job schedulers.
var ErrLegacyRepeatableJob = errors.New("bullmq: legacy repeatable job metadata is not supported")

// legacyRepeatableJobsMigrationURL documents the migration of legacy
// repeatable jobs to job schedulers.
const legacyRepeatableJobsMigrationURL = "https://docs.bullmq.io/guide/migrations/migrate-from-v5-to-v6"

func legacyRepeatableJobError(key string) error {
	return fmt.Errorf("%w (key: %q); migrate legacy repeatable jobs to job schedulers, see %s",
		ErrLegacyRepeatableJob, key, legacyRepeatableJobsMigrationURL)
}

// hasLegacyRepeatableKeyShape reports whether key looks like a legacy
// repeatable job key, `name:id:endDate:tz:pattern` (or `...:every`), as
// Node's hasLegacyRepeatableKeyShape does.
func hasLegacyRepeatableKeyShape(key string) bool {
	colons := make([]int, 0, 4)
	for i := 0; i < len(key) && len(colons) < 4; i++ {
		if key[i] == ':' {
			colons = append(colons, i)
		}
	}
	if len(colons) < 4 {
		return false
	}
	// The end date is empty or numeric.
	if endDate := key[colons[1]+1 : colons[2]]; endDate != "" && !isDigits(endDate) {
		return false
	}
	suffix := key[colons[3]+1:]
	if suffix == "" {
		return false
	}
	return strings.Contains(suffix, " ") || isDigits(suffix)
}

func isDigits(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// UpsertJobScheduler creates the job scheduler id, or replaces its schedule
// and template, and adds the job of its next iteration, which it returns.
// The scheduler then keeps producing jobs: each time a worker fetches one,
// it adds the job of the following iteration. The jobs have the id
// `repeat:<id>:<due time in Unix milliseconds>`.
//
// It returns nil, without error, when the schedule produces no job: its
// limit is reached, or no time matching Pattern is left before EndDate.
func (q *Queue) UpsertJobScheduler(ctx context.Context, id string, repeat RepeatOptions, template *JobTemplate) (*Job, error) {
	if id == "" {
		return nil, configError("job scheduler id must be provided")
	}
	if repeat.EndDate != 0 && repeat.EndDate < nowMillis() {
		return nil, configError("End date must be greater than current timestamp")
	}
	if template == nil {
		template = &JobTemplate{}
	}
	if o := template.Opts; o != nil {
		if o.JobID != "" || o.Delay != nil || o.Deduplication != nil || o.Repeat != nil {
			return nil, configError("job scheduler templates cannot set jobId, delay, deduplication or repeat")
		}
	}
	name := template.Name
	if name == "" {
		name = id
	}
	data := []byte("{}")
	if template.Data != nil {
		var err error
		if data, err = json.Marshal(template.Data); err != nil {
			return nil, err
		}
		if string(data) == "null" {
			data = []byte("{}")
		}
	}
	opts := mergeJobOptions(template.Opts, q.defaultJobOptions)
	opts.JobID, opts.Delay, opts.Deduplication = "", nil, nil
	opts.Repeat, opts.PrevMillis, opts.RepeatJobKey = nil, 0, ""
	if opts.Backoff != nil {
		if err := opts.Backoff.validate(); err != nil {
			return nil, err
		}
	}
	if p := opts.priorityVal(); p < 0 || p > priorityLimit {
		return nil, configError("priority should be between 0 and %d", priorityLimit)
	}
	repeat.Count = 0
	return upsertJobScheduler(ctx, q.backend, id, repeat, name, data, opts, true, "")
}

// upsertJobScheduler is Node's JobScheduler.upsertJobScheduler. With
// override it (re)defines the scheduler from repeat and opts, the template
// options; otherwise it advances the existing scheduler from the job
// producerID, whose options are opts and whose repeat options are repeat.
func upsertJobScheduler(ctx context.Context, b Backend, id string, repeat RepeatOptions, name string, data []byte, opts *JobOptions, override bool, producerID string) (*Job, error) {
	switch {
	case repeat.Pattern != "" && repeat.Every != 0:
		return nil, configError("Both .pattern and .every options are defined for this repeatable job")
	case repeat.Pattern == "" && repeat.Every == 0:
		return nil, configError("Either .pattern or .every options must be defined for this repeatable job")
	case repeat.Immediately && repeat.StartDate != 0:
		return nil, configError("Both .immediately and .startDate options are defined for this repeatable job")
	case repeat.Every < 0:
		return nil, configError(".every must be a positive number of milliseconds")
	}
	if opts == nil {
		opts = &JobOptions{}
	}

	iterationCount := repeat.Count + 1
	if repeat.Limit > 0 && iterationCount > repeat.Limit {
		return nil, nil
	}
	now := nowMillis()
	if repeat.EndDate != 0 && now > repeat.EndDate {
		return nil, nil
	}
	now = max(now, opts.PrevMillis)

	var nextMillis int64
	if repeat.Pattern != "" {
		next, ok, err := nextPatternMillis(now, repeat)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, nil
		}
		nextMillis = max(next, now)
	}
	var offset int64
	if repeat.Every != 0 {
		offset = repeat.Offset
	}

	jobOpts := nextJobOptions(nextMillis, id, opts, repeat, iterationCount, offset)
	if override {
		jobID, delay, err := b.AddJobScheduler(ctx, NewJobScheduler{
			ID:           id,
			NextMillis:   nextMillis,
			Name:         name,
			Pattern:      repeat.Pattern,
			Every:        repeat.Every,
			Tz:           repeat.Tz,
			Limit:        repeat.Limit,
			Offset:       offset,
			StartDate:    repeat.StartDate,
			EndDate:      repeat.EndDate,
			TemplateData: data,
			TemplateOpts: opts,
			JobOpts:      jobOpts,
			ProducerID:   producerID,
		})
		if err != nil {
			return nil, err
		}
		added := *jobOpts
		added.JobID, added.Delay = jobID, Int64(delay)
		return newSchedulerJob(b, jobID, name, data, &added), nil
	}

	jobID, err := b.UpdateJobSchedulerNextMillis(ctx, id, nextMillis, data, jobOpts, producerID)
	if err != nil || jobID == "" {
		return nil, err
	}
	return newSchedulerJob(b, jobID, name, data, jobOpts), nil
}

// nextPatternMillis is Node's defaultRepeatStrategy: the first time
// matching the pattern after millis (or after the start date), in the
// scheduler's time zone. ok is false when there is none before the end
// date.
func nextPatternMillis(millis int64, repeat RepeatOptions) (next int64, ok bool, err error) {
	expr, err := cronparity.Parse(repeat.Pattern)
	if err != nil {
		var perr *cronparity.ParseError
		if errors.As(err, &perr) {
			return 0, false, configError("invalid repeat pattern %q: %s", repeat.Pattern, perr.Msg)
		}
		return 0, false, err
	}
	loc, err := cronparity.LoadLocation(repeat.Tz)
	if err != nil {
		return 0, false, configError("invalid repeat time zone %q", repeat.Tz)
	}
	current := max(millis, repeat.StartDate)
	opts := cronparity.Options{CurrentDate: time.UnixMilli(current), Location: loc}
	if repeat.StartDate != 0 {
		opts.StartDate = time.UnixMilli(repeat.StartDate)
	}
	if repeat.EndDate != 0 {
		opts.EndDate = time.UnixMilli(repeat.EndDate)
	}
	if repeat.Immediately {
		return nowMillis(), true, nil
	}
	t, err := expr.Iterator(opts).Next()
	if err != nil {
		return 0, false, nil
	}
	return t.UnixMilli(), true, nil
}

// nextJobOptions is Node's getNextJobOpts: the options of the job of the
// iteration due at nextMillis (0 for Every schedulers, whose due time the
// backend computes).
func nextJobOptions(nextMillis int64, id string, opts *JobOptions, repeat RepeatOptions, count, offset int64) *JobOptions {
	merged := *opts
	now := nowMillis()
	merged.Timestamp = now
	merged.RepeatJobKey = id
	merged.PrevMillis = nextMillis
	merged.JobID = ""
	merged.Delay = nil
	if nextMillis != 0 {
		merged.JobID = schedulerJobID(id, nextMillis)
		merged.Delay = Int64(max(nextMillis+offset-now, 0))
	}
	repeat.Immediately = false
	repeat.Offset = offset
	repeat.Count = count
	merged.Repeat = &repeat
	return &merged
}

// schedulerJobID is the id of the job of a scheduler's iteration due at
// millis.
func schedulerJobID(id string, millis int64) string {
	return "repeat:" + id + ":" + strconv.FormatInt(millis, 10)
}

func newSchedulerJob(b Backend, jobID, name string, data []byte, opts *JobOptions) *Job {
	return &Job{
		ID:           jobID,
		Name:         name,
		Data:         json.RawMessage(data),
		Opts:         opts,
		Timestamp:    opts.Timestamp,
		Delay:        opts.delayMs(),
		Priority:     opts.priorityVal(),
		RepeatJobKey: opts.RepeatJobKey,
		QueueName:    b.QueueName(),
		backend:      b,
	}
}

// RemoveJobScheduler removes the job scheduler id and the job of its next
// iteration, unless that job is already being processed. It reports whether
// the scheduler existed.
func (q *Queue) RemoveJobScheduler(ctx context.Context, id string) (bool, error) {
	return q.backend.RemoveJobScheduler(ctx, id)
}

// JobScheduler returns the job scheduler id, or nil when it does not exist.
func (q *Queue) JobScheduler(ctx context.Context, id string) (*JobScheduler, error) {
	s, err := q.backend.GetJobScheduler(ctx, id)
	if err != nil {
		return nil, err
	}
	if s == nil && hasLegacyRepeatableKeyShape(id) {
		return nil, legacyRepeatableJobError(id)
	}
	return s, nil
}

// JobSchedulers returns the job schedulers ranked start to end (inclusive;
// -1 is the last one) by the due time of their next job, latest first
// unless asc is set.
func (q *Queue) JobSchedulers(ctx context.Context, start, end int64, asc bool) ([]*JobScheduler, error) {
	entries, err := q.backend.GetJobSchedulersRange(ctx, start, end, asc)
	if err != nil {
		return nil, err
	}
	out := make([]*JobScheduler, 0, len(entries))
	for _, e := range entries {
		s, err := q.backend.GetJobScheduler(ctx, e.ID)
		if err != nil {
			return nil, err
		}
		if s == nil {
			if hasLegacyRepeatableKeyShape(e.ID) {
				return nil, legacyRepeatableJobError(e.ID)
			}
			// Listed but without metadata: a leftover, removed as Node does.
			if _, err := q.backend.RemoveJobScheduler(ctx, e.ID); err != nil {
				return nil, err
			}
			continue
		}
		s.Next = e.Next
		out = append(out, s)
	}
	return out, nil
}

// JobSchedulersCount returns the number of job schedulers.
func (q *Queue) JobSchedulersCount(ctx context.Context) (int64, error) {
	return q.backend.GetJobSchedulersCount(ctx)
}

// scheduleNextIteration advances the job scheduler that produced job, as
// Node's worker does when it fetches a job (nextJobFromJobData): the job of
// the next iteration is added before this one is processed. It returns
// false when that failed; the job must then be left active, unprocessed, so
// that the stalled check retries it, and the scheduling with it.
//
// Jobs of legacy repeatable jobs (keys `name:id:endDate:tz:pattern`) are
// processed, but their schedule cannot be advanced, which is reported.
func (w *Worker) scheduleNextIteration(ctx context.Context, job *Job) bool {
	key := job.RepeatJobKey
	legacy := hasLegacyRepeatableKeyShape(key)
	isScheduler := !legacy
	err := w.retryTransition(ctx, func(c context.Context) error {
		if legacy {
			var err error
			if isScheduler, err = w.backend.IsJobScheduler(c, key); err != nil || !isScheduler {
				return err
			}
		}
		var repeat RepeatOptions
		if job.Opts != nil && job.Opts.Repeat != nil {
			repeat = *job.Opts.Repeat
		}
		_, err := upsertJobScheduler(c, w.backend, key, repeat, job.Name, job.Data, job.Opts, false, job.ID)
		return err
	})
	if err != nil {
		w.emitError(fmt.Errorf("bullmq: failed to add repeatable job for next iteration: %w", err))
		return false
	}
	if !isScheduler {
		w.emitError(fmt.Errorf("bullmq: failed to add repeatable job for next iteration: %w", legacyRepeatableJobError(key)))
	}
	return true
}
