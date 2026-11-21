package postgresbackend

import (
	"encoding/json"

	"github.com/jackc/pgx/v5"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// optsLongNames maps the short option keys bullmq.JobOptions uses in JSON
// (the Redis storage format) to the long JobsOptions names stored on
// PostgreSQL, where the shared SQL reads them (for example
// `opts->'deduplication'` or `opts->>'failParentOnFailure'`). It is Node's
// optsDecodeMap, a fixed part of the cross-runtime format; every other key is
// stored as JobOptions encodes it.
var optsLongNames = map[string]string{
	"de":   "deduplication",
	"fpof": "failParentOnFailure",
	"cpof": "continueParentOnFailure",
	"idof": "ignoreDependencyOnFailure",
	"rdof": "removeDependencyOnFailure",
	"kl":   "keepLogs",
}

var optsShortNames = func() map[string]string {
	m := make(map[string]string, len(optsLongNames))
	for short, long := range optsLongNames {
		m[long] = short
	}
	return m
}()

// encodeOpts builds the stored opts document from the JSON encoding of opts,
// so every option JobOptions knows about is persisted.
func encodeOpts(opts *bullmq.JobOptions) ([]byte, error) {
	if opts == nil {
		return []byte("{}"), nil
	}
	raw, err := json.Marshal(opts)
	if err != nil {
		return nil, err
	}
	return renameKeys(raw, optsLongNames)
}

// decodeOpts parses a stored opts document, written by any runtime. Values
// that do not fit JobOptions are skipped.
func decodeOpts(raw []byte) *bullmq.JobOptions {
	opts := &bullmq.JobOptions{}
	if len(raw) == 0 {
		return opts
	}
	renamed, err := renameKeys(raw, optsShortNames)
	if err != nil {
		return opts
	}
	// PostgreSQL/Node may store a numeric backoff directly. Go's JSON decoder
	// cannot fit that shape into *Backoff, so normalize it to the fixed strategy.
	var m map[string]json.RawMessage
	if err := json.Unmarshal(renamed, &m); err == nil {
		if rawBackoff, ok := m["backoff"]; ok {
			var delay int64
			if err := json.Unmarshal(rawBackoff, &delay); err == nil {
				m["backoff"], _ = json.Marshal(map[string]any{"type": "fixed", "delay": delay})
				renamed, _ = json.Marshal(m)
			}
		}
	}
	_ = json.Unmarshal(renamed, opts)
	return opts
}

func renameKeys(raw []byte, names map[string]string) ([]byte, error) {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, err
	}
	for from, to := range names {
		if v, ok := m[from]; ok {
			delete(m, from)
			m[to] = v
		}
	}
	return json.Marshal(m)
}

// jobRow holds the columns of a `job` row the backend reads.
type jobRow struct {
	id, name                                      string
	data, opts, progress, returnValue, trace      []byte
	failedReason, deferredFailure, processedBy    *string
	schedulerID, parentQueue, parentID, parentKey *string
	dedupID                                       *string
	priority, attemptsMade, attemptsStarted       int64
	stalledCount, delay, addedAt                  int64
	processedAt, finishedAt                       *int64
}

// scanJobRows reads the rows of a command returning `job` rows (SELECT * or
// SETOF job). Columns are matched by name, so columns added by later
// migrations are ignored.
func scanJobRows(rows pgx.Rows) ([]*bullmq.JobRecord, error) {
	defer rows.Close()
	var out []*bullmq.JobRecord
	var r jobRow
	fields := rows.FieldDescriptions()
	dest := make([]any, len(fields))
	for i, f := range fields {
		switch f.Name {
		case "id":
			dest[i] = &r.id
		case "name":
			dest[i] = &r.name
		case "data":
			dest[i] = &r.data
		case "opts":
			dest[i] = &r.opts
		case "progress":
			dest[i] = &r.progress
		case "return_value":
			dest[i] = &r.returnValue
		case "stacktrace":
			dest[i] = &r.trace
		case "failed_reason":
			dest[i] = &r.failedReason
		case "deferred_failure":
			dest[i] = &r.deferredFailure
		case "processed_by":
			dest[i] = &r.processedBy
		case "scheduler_id":
			dest[i] = &r.schedulerID
		case "parent_queue":
			dest[i] = &r.parentQueue
		case "parent_id":
			dest[i] = &r.parentID
		case "parent_key":
			dest[i] = &r.parentKey
		case "dedup_id":
			dest[i] = &r.dedupID
		case "priority":
			dest[i] = &r.priority
		case "attempts_made":
			dest[i] = &r.attemptsMade
		case "attempts_started":
			dest[i] = &r.attemptsStarted
		case "stalled_count":
			dest[i] = &r.stalledCount
		case "delay_ms":
			dest[i] = &r.delay
		case "added_at_ms":
			dest[i] = &r.addedAt
		case "processed_at_ms":
			dest[i] = &r.processedAt
		case "finished_at_ms":
			dest[i] = &r.finishedAt
		}
	}
	for rows.Next() {
		r = jobRow{}
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		out = append(out, r.record())
	}
	return out, rows.Err()
}

func (r *jobRow) record() *bullmq.JobRecord {
	rec := &bullmq.JobRecord{
		ID:              r.id,
		Name:            r.name,
		Data:            json.RawMessage("{}"),
		Opts:            decodeOpts(r.opts),
		Priority:        r.priority,
		AttemptsMade:    r.attemptsMade,
		AttemptsStarted: r.attemptsStarted,
		StalledCounter:  r.stalledCount,
		Delay:           r.delay,
		Timestamp:       r.addedAt,
		FailedReason:    deref(r.failedReason),
		DeferredFailure: deref(r.deferredFailure),
		ProcessedBy:     deref(r.processedBy),
		RepeatJobKey:    deref(r.schedulerID),
		ParentKey:       deref(r.parentKey),
		DeduplicationID: deref(r.dedupID),
	}
	if len(r.data) > 0 {
		rec.Data = json.RawMessage(r.data)
	}
	if len(r.progress) > 0 {
		_ = rec.Progress.UnmarshalJSON(r.progress)
	}
	if len(r.returnValue) > 0 {
		rec.ReturnValue = json.RawMessage(r.returnValue)
	}
	if len(r.trace) > 0 {
		_ = json.Unmarshal(r.trace, &rec.Stacktrace)
	}
	if r.parentID != nil {
		rec.Parent = &bullmq.ParentKeys{ID: *r.parentID, QueueKey: deref(r.parentQueue)}
	}
	if r.processedAt != nil {
		rec.ProcessedOn = *r.processedAt
	}
	if r.finishedAt != nil {
		rec.FinishedOn = *r.finishedAt
	}
	return rec
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
