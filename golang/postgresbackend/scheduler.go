package postgresbackend

import (
	"bytes"
	"context"
	"encoding/json"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// schedulerOpts builds the scheduler options argument of add_job_scheduler,
// as Node's RepeatableOptions.
func schedulerOpts(s bullmq.NewJobScheduler) map[string]any {
	m := map[string]any{"name": s.Name}
	if s.Pattern != "" {
		m["pattern"] = s.Pattern
	}
	if s.Tz != "" {
		m["tz"] = s.Tz
	}
	for key, v := range map[string]int64{
		"every": s.Every, "limit": s.Limit, "offset": s.Offset,
		"startDate": s.StartDate, "endDate": s.EndDate,
	} {
		if v != 0 {
			m[key] = v
		}
	}
	return m
}

func templateData(data []byte) string {
	if len(data) == 0 {
		return "{}"
	}
	return string(data)
}

// nullable returns nil for the zero value, which the commands read as NULL.
func nullable[T comparable](v T) any {
	var zero T
	if v == zero {
		return nil
	}
	return v
}

// AddJobScheduler runs add_job_scheduler.
func (b *Backend) AddJobScheduler(ctx context.Context, s bullmq.NewJobScheduler) (string, int64, error) {
	opts, err := json.Marshal(schedulerOpts(s))
	if err != nil {
		return "", 0, err
	}
	templateOpts, err := encodeOpts(s.TemplateOpts)
	if err != nil {
		return "", 0, err
	}
	jobOpts, err := encodeOpts(s.JobOpts)
	if err != nil {
		return "", 0, err
	}
	var next any
	if s.Every == 0 {
		next = s.NextMillis
	}
	var (
		jobID string
		delay int64
	)
	err = b.queryRow(ctx, "add_job_scheduler", []any{
		b.name, s.ID, next, templateData(s.TemplateData), string(templateOpts),
		string(opts), string(jobOpts), nowMillis(), nullable(s.ProducerID),
	}, &jobID, &delay)
	return jobID, delay, err
}

// UpdateJobSchedulerNextMillis runs update_job_scheduler.
func (b *Backend) UpdateJobSchedulerNextMillis(ctx context.Context, schedulerID string, nextMillis int64, data []byte, jobOpts *bullmq.JobOptions, producerID string) (string, error) {
	encoded, err := encodeOpts(jobOpts)
	if err != nil {
		return "", err
	}
	var jobID *string
	err = b.queryRow(ctx, "update_job_scheduler", []any{
		b.name, schedulerID, nullable(nextMillis), templateData(data), string(encoded),
		nowMillis(), nullable(producerID),
	}, &jobID)
	if err != nil || jobID == nil {
		return "", err
	}
	return *jobID, nil
}

// RemoveJobScheduler runs remove_job_scheduler, which returns 0 when the
// scheduler existed.
func (b *Backend) RemoveJobScheduler(ctx context.Context, schedulerID string) (bool, error) {
	var code int64
	if err := b.queryRow(ctx, "remove_job_scheduler", []any{b.name, schedulerID}, &code); err != nil {
		return false, err
	}
	return code == 0, nil
}

// GetJobScheduler runs get_job_scheduler.
func (b *Backend) GetJobScheduler(ctx context.Context, schedulerID string) (*bullmq.JobScheduler, error) {
	var (
		name, tz, pattern                          *string
		ic, limit, start, end, every, offset, next *int64
		data, opts                                 []byte
	)
	err := b.queryRow(ctx, "get_job_scheduler", []any{b.name, schedulerID},
		&name, &ic, &limit, &start, &end, &tz, &pattern, &every, &offset, &data, &opts, &next)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	s := &bullmq.JobScheduler{
		ID:             schedulerID,
		Name:           deref(name),
		IterationCount: derefInt(ic),
		Limit:          derefInt(limit),
		StartDate:      derefInt(start),
		EndDate:        derefInt(end),
		Tz:             deref(tz),
		Pattern:        deref(pattern),
		Every:          derefInt(every),
		Offset:         derefInt(offset),
		Next:           derefInt(next),
	}
	data, opts = nonEmptyObject(data), nonEmptyObject(opts)
	if data != nil || opts != nil {
		s.Template = &bullmq.JobSchedulerTemplate{}
		if data != nil {
			s.Template.Data = json.RawMessage(data)
		}
		if opts != nil {
			s.Template.Opts = decodeOpts(opts)
		}
	}
	return s, nil
}

// nonEmptyObject returns raw, compacted as Node's JSON.stringify writes it,
// unless it is null or an empty JSON object, which the other runtimes do not
// report as a template.
func nonEmptyObject(raw []byte) []byte {
	var buf bytes.Buffer
	if json.Compact(&buf, raw) != nil {
		return nil
	}
	compact := buf.Bytes()
	if len(compact) == 0 || bytes.Equal(compact, []byte("null")) || bytes.Equal(compact, []byte("{}")) {
		return nil
	}
	return compact
}

func derefInt(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}

// IsJobScheduler runs is_job_scheduler.
func (b *Backend) IsJobScheduler(ctx context.Context, id string) (bool, error) {
	var exists bool
	err := b.queryRow(ctx, "is_job_scheduler", []any{b.name, id}, &exists)
	return exists, err
}

// GetJobSchedulersRange runs get_job_schedulers_range. As in Node.js, a
// negative end means every remaining scheduler.
func (b *Backend) GetJobSchedulersRange(ctx context.Context, start, end int64, asc bool) ([]bullmq.JobSchedulerNext, error) {
	var count any
	if end >= 0 {
		if end < start {
			return []bullmq.JobSchedulerNext{}, nil
		}
		count = end - start + 1
	}
	out := []bullmq.JobSchedulerNext{}
	err := b.run(ctx, "get_job_schedulers_range", func(ctx context.Context, sql string) error {
		rows, err := b.pool.Query(ctx, sql, b.name, asc, start, count)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var (
				id   string
				next *int64
			)
			if err := rows.Scan(&id, &next); err != nil {
				return err
			}
			out = append(out, bullmq.JobSchedulerNext{ID: id, Next: derefInt(next)})
		}
		return rows.Err()
	})
	return out, err
}

// GetJobSchedulersCount runs get_job_schedulers_count.
func (b *Backend) GetJobSchedulersCount(ctx context.Context) (int64, error) {
	var n int64
	err := b.queryRow(ctx, "get_job_schedulers_count", []any{b.name}, &n)
	return n, err
}
