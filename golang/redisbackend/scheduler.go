package redisbackend

import (
	"context"
	"encoding/json"

	"github.com/redis/go-redis/v9"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// repeatValue builds the `repeat` job option the shared commands store and
// read (`opts.repeat.offset`), with only the fields that are set.
func repeatValue(r *bullmq.RepeatOptions) map[string]any {
	m := make(map[string]any, 8)
	if r.Pattern != "" {
		m["pattern"] = r.Pattern
	}
	if r.Tz != "" {
		m["tz"] = r.Tz
	}
	for key, v := range map[string]int64{
		"every": r.Every, "limit": r.Limit, "offset": r.Offset,
		"startDate": r.StartDate, "endDate": r.EndDate, "count": r.Count,
	} {
		if v != 0 {
			m[key] = v
		}
	}
	if r.Immediately {
		m["immediately"] = true
	}
	return m
}

// schedulerOptsValue builds the scheduler options argument of
// addJobScheduler, as Node's RepeatableOptions.
func schedulerOptsValue(s bullmq.NewJobScheduler) map[string]any {
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

// producerKey is the key of the job that produced an iteration, or "".
func (b *Backend) producerKey(producerID string) string {
	if producerID == "" {
		return ""
	}
	return b.keys.Job(producerID)
}

func templateData(data []byte) string {
	if len(data) == 0 {
		return "{}"
	}
	return string(data)
}

// AddJobScheduler runs addJobScheduler.
func (b *Backend) AddJobScheduler(ctx context.Context, s bullmq.NewJobScheduler) (string, int64, error) {
	k := b.keys
	schedOpts, err := packMsgpack(schedulerOptsValue(s))
	if err != nil {
		return "", 0, err
	}
	templateOpts, err := packJobOptions(orEmpty(s.TemplateOpts))
	if err != nil {
		return "", 0, err
	}
	jobOpts, err := packJobOptions(orEmpty(s.JobOpts))
	if err != nil {
		return "", 0, err
	}
	res, err := b.runScript(ctx, "addJobScheduler", []string{
		k.Repeat(), k.Delayed(), k.Wait(), k.Paused(), k.Meta(), k.Prioritized(),
		k.Marker(), k.ID(), k.Events(), k.PC(), k.Active(),
	}, s.NextMillis, schedOpts, s.ID, templateData(s.TemplateData), templateOpts, jobOpts,
		nowMillis(), k.KeyPrefix(), b.producerKey(s.ProducerID))
	if err != nil {
		return "", 0, err
	}
	if code, ok := res.(int64); ok && code < 0 {
		return "", 0, scriptError("addJobScheduler", code)
	}
	reply, _ := res.([]any)
	if len(reply) < 2 {
		return "", 0, configError("unexpected reply from addJobScheduler: %v", res)
	}
	jobID, _ := asString(reply[0])
	delay, _ := asInt64(reply[1])
	return jobID, delay, nil
}

// UpdateJobSchedulerNextMillis runs updateJobScheduler.
func (b *Backend) UpdateJobSchedulerNextMillis(ctx context.Context, schedulerID string, nextMillis int64, data []byte, jobOpts *bullmq.JobOptions, producerID string) (string, error) {
	k := b.keys
	packed, err := packJobOptions(orEmpty(jobOpts))
	if err != nil {
		return "", err
	}
	res, err := b.runScript(ctx, "updateJobScheduler", []string{
		k.Repeat(), k.Delayed(), k.Wait(), k.Paused(), k.Meta(), k.Prioritized(),
		k.Marker(), k.ID(), k.Events(), k.PC(), b.producerKey(producerID), k.Active(),
	}, nextMillis, schedulerID, templateData(data), packed, nowMillis(), k.KeyPrefix(), producerID)
	if err != nil || res == nil {
		return "", err
	}
	jobID, _ := asString(res)
	return jobID, nil
}

// RemoveJobScheduler runs removeJobScheduler, which returns 0 when the
// scheduler existed.
func (b *Backend) RemoveJobScheduler(ctx context.Context, schedulerID string) (bool, error) {
	k := b.keys
	res, err := b.runScript(ctx, "removeJobScheduler",
		[]string{k.Repeat(), k.Delayed(), k.Events()}, schedulerID, k.KeyPrefix())
	if err != nil {
		return false, err
	}
	code, _ := asInt64(res)
	return code == 0, nil
}

// GetJobScheduler runs getJobScheduler.
func (b *Backend) GetJobScheduler(ctx context.Context, schedulerID string) (*bullmq.JobScheduler, error) {
	res, err := b.runScript(ctx, "getJobScheduler", []string{b.keys.Repeat()}, schedulerID)
	if err != nil {
		return nil, err
	}
	reply, _ := res.([]any)
	if len(reply) < 2 || reply[1] == nil {
		return nil, nil
	}
	s := schedulerFromHash(schedulerID, flatToMap(reply[0]))
	if s == nil {
		return nil, nil
	}
	if next, ok := asString(reply[1]); ok {
		s.Next = parseInt(next)
	}
	return s, nil
}

// schedulerFromHash rebuilds a scheduler from its `repeat:<id>` hash, as
// Node's transformSchedulerData does. It returns nil for an empty hash.
func schedulerFromHash(id string, h map[string]string) *bullmq.JobScheduler {
	if len(h) == 0 {
		return nil
	}
	s := &bullmq.JobScheduler{
		ID:             id,
		Name:           h["name"],
		IterationCount: parseInt(h["ic"]),
		Limit:          parseInt(h["limit"]),
		StartDate:      parseInt(h["startDate"]),
		EndDate:        parseInt(h["endDate"]),
		Tz:             h["tz"],
		Pattern:        h["pattern"],
		Every:          parseInt(h["every"]),
		Offset:         parseInt(h["offset"]),
	}
	data, opts := h["data"], h["opts"]
	if data != "" || opts != "" {
		s.Template = &bullmq.JobSchedulerTemplate{}
		if data != "" {
			s.Template.Data = json.RawMessage(data)
		}
		if opts != "" {
			s.Template.Opts = &bullmq.JobOptions{}
			_ = json.Unmarshal([]byte(opts), s.Template.Opts)
		}
	}
	return s
}

// IsJobScheduler checks for the iteration count, which only job schedulers
// store, unlike legacy repeatable jobs.
func (b *Backend) IsJobScheduler(ctx context.Context, id string) (bool, error) {
	return b.rdb.HExists(ctx, b.keys.Repeat()+":"+id, "ic").Result()
}

// GetJobSchedulersRange reads the `repeat` sorted set.
func (b *Backend) GetJobSchedulersRange(ctx context.Context, start, end int64, asc bool) ([]bullmq.JobSchedulerNext, error) {
	var (
		entries []redis.Z
		err     error
	)
	if asc {
		entries, err = b.rdb.ZRangeWithScores(ctx, b.keys.Repeat(), start, end).Result()
	} else {
		entries, err = b.rdb.ZRevRangeWithScores(ctx, b.keys.Repeat(), start, end).Result()
	}
	if err != nil {
		return nil, err
	}
	out := make([]bullmq.JobSchedulerNext, 0, len(entries))
	for _, e := range entries {
		id, ok := e.Member.(string)
		if !ok {
			continue
		}
		out = append(out, bullmq.JobSchedulerNext{ID: id, Next: int64(e.Score)})
	}
	return out, nil
}

// GetJobSchedulersCount returns the size of the `repeat` sorted set.
func (b *Backend) GetJobSchedulersCount(ctx context.Context) (int64, error) {
	return b.rdb.ZCard(ctx, b.keys.Repeat()).Result()
}

func orEmpty(opts *bullmq.JobOptions) *bullmq.JobOptions {
	if opts == nil {
		return &bullmq.JobOptions{}
	}
	return opts
}
