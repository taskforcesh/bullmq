package postgresbackend

import (
	"context"
	"encoding/json"
	"math"
	"strconv"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// batchEntry is one element of the JSON array consumed by the add_jobs_bulk
// and add_flow commands, in the shape the Node.js backend sends.
type batchEntry struct {
	Queue string `json:"queue"`
	ID    string `json:"id"`
	Name  string `json:"name"`
	// Data is the JSON encoded payload as a string: the SQL reads it with
	// `->>` and casts it to jsonb.
	Data                 string          `json:"data"`
	Opts                 json.RawMessage `json:"opts"`
	Priority             int64           `json:"priority"`
	Delay                int64           `json:"delay"`
	Timestamp            int64           `json:"timestamp"`
	Attempts             int64           `json:"attempts"`
	ParentQueue          *string         `json:"parentQueue"`
	ParentID             *string         `json:"parentId"`
	ParentKey            *string         `json:"parentKey"`
	DedupID              *string         `json:"dedupId"`
	SchedulerID          *string         `json:"schedulerId"`
	LIFO                 bool            `json:"lifo"`
	AddToWaitingChildren bool            `json:"addToWaitingChildren"`
}

// prepareAdd computes everything stored for job.
func (b *Backend) prepareAdd(job bullmq.NewJob) (batchEntry, error) {
	opts := job.Opts
	if opts == nil {
		opts = &bullmq.JobOptions{}
	}
	encodedOpts, err := encodeOpts(opts)
	if err != nil {
		return batchEntry{}, err
	}
	data := string(job.Data)
	if data == "" {
		data = "{}"
	}
	e := batchEntry{
		Queue:     b.name,
		ID:        opts.JobID,
		Name:      job.Name,
		Data:      data,
		Opts:      encodedOpts,
		Priority:  int64Val(opts.Priority),
		Delay:     max(int64Val(opts.Delay), 0),
		Timestamp: opts.Timestamp,
		Attempts:  int64Val(opts.Attempts),
		LIFO:      opts.LIFO != nil && *opts.LIFO,
	}
	if e.Attempts <= 0 {
		e.Attempts = 1
	}
	e.Attempts = min(e.Attempts, math.MaxInt32)
	if e.Timestamp == 0 {
		e.Timestamp = nowMillis()
	}
	if opts.Parent != nil {
		ref, key, err := b.ResolveParent(opts.Parent)
		if err != nil {
			return batchEntry{}, err
		}
		e.ParentQueue = &ref.QueueKey
		e.ParentID = &ref.ID
		e.ParentKey = &key
	}
	if opts.Deduplication != nil && opts.Deduplication.ID != "" {
		id := opts.Deduplication.ID
		e.DedupID = &id
	}
	return e, nil
}

// AddJob adds a single job and returns its id, or the id of the job that a
// live deduplication key points at.
func (b *Backend) AddJob(ctx context.Context, job bullmq.NewJob) (string, error) {
	e, err := b.prepareAdd(job)
	if err != nil {
		return "", err
	}
	var id string
	err = b.queryRow(ctx, "add_job", []any{
		e.Queue, e.ID, e.Name, e.Data, string(e.Opts),
		e.Priority, e.Delay, e.Timestamp, e.Attempts,
		e.ParentQueue, e.ParentID, e.ParentKey, e.DedupID, e.SchedulerID,
		e.LIFO,
	}, &id)
	return id, err
}

// AddJobs adds every job in one atomic statement, so they become visible
// together: set-based add_jobs_bulk when the jobs are independent, the
// row-by-row add_flow when some have a parent or a deduplication id.
func (b *Backend) AddJobs(ctx context.Context, jobs []bullmq.NewJob) ([]string, error) {
	if len(jobs) == 0 {
		return nil, nil
	}
	entries := make([]batchEntry, len(jobs))
	independent := true
	for i, job := range jobs {
		e, err := b.prepareAdd(job)
		if err != nil {
			return nil, err
		}
		entries[i] = e
		if e.ParentID != nil || e.DedupID != nil {
			independent = false
		}
	}
	payload, err := json.Marshal(entries)
	if err != nil {
		return nil, err
	}
	var ids []string
	if independent {
		ids, err = b.queryStrings(ctx, "add_jobs_bulk", b.name, string(payload))
	} else {
		ids, err = b.queryStrings(ctx, "add_flow", string(payload))
	}
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		if code, ok := negativeCode(id); ok {
			return nil, codeError("addJob", code)
		}
	}
	return ids, nil
}

// negativeCode reports whether an id returned by add_flow is an error code.
// Custom ids cannot be integers, so a negative integer is always a code.
func negativeCode(id string) (int64, bool) {
	n, err := strconv.ParseInt(id, 10, 64)
	if err != nil || n >= 0 || strconv.FormatInt(n, 10) != id {
		return 0, false
	}
	return n, true
}

func int64Val(p *int64) int64 {
	if p == nil {
		return 0
	}
	return *p
}
