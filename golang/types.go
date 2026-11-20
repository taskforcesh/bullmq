package bullmq

import (
	"encoding/json"
	"math"
	"strconv"
	"time"
)

// JobState is the lifecycle state of a job.
type JobState string

// Job states, matching the values returned by the shared `getState` command.
const (
	StateWaiting         JobState = "waiting"
	StateActive          JobState = "active"
	StateDelayed         JobState = "delayed"
	StatePrioritized     JobState = "prioritized"
	StateCompleted       JobState = "completed"
	StateFailed          JobState = "failed"
	StateWaitingChildren JobState = "waiting-children"
	StateUnknown         JobState = "unknown"
)

// StatePaused designates the paused list of older BullMQ versions, as
// Node's "paused" job type does. Jobs of a paused queue stay waiting, and
// Queue.Resume moves any job left in that list back to wait. It is accepted
// by Clean, JobCounts and JobIDs but is never the state of a job. On
// PostgreSQL, which has no paused list, JobCounts and JobIDs report it
// empty, while Clean treats it as StateWaiting, as the shared SQL does.
const StatePaused JobState = "paused"

// AllStates lists every state that can be queried through Queue.JobCounts.
var AllStates = []JobState{
	StateWaiting, StateActive, StateDelayed, StatePrioritized,
	StateCompleted, StateFailed, StateWaitingChildren,
}

// BackoffType selects the delay curve used between retries.
type BackoffType string

// Supported backoff strategies.
const (
	BackoffFixed       BackoffType = "fixed"
	BackoffExponential BackoffType = "exponential"
)

// Backoff configures the retry delay of a job.
type Backoff struct {
	// Type is the strategy name. Custom strategy names are forwarded to the
	// worker's WorkerOptions.BackoffStrategy callback.
	Type BackoffType `json:"type"`
	// Delay is the base delay in milliseconds.
	Delay int64 `json:"delay,omitempty"`
	// Jitter is the fraction (0 to 1) of the delay that is randomized: the
	// effective delay is drawn uniformly from [delay*(1-Jitter), delay),
	// excluding delay itself, and rounded down to whole milliseconds. 0 (the
	// default) disables jitter. Applies to the fixed and exponential
	// strategies.
	Jitter float64 `json:"jitter,omitempty"`
}

// validate checks that Delay is not negative and Jitter is a number between
// 0 and 1.
func (b *Backoff) validate() error {
	if b.Delay < 0 {
		return configError("backoff delay must be greater or equal than 0, got %d", b.Delay)
	}
	if math.IsNaN(b.Jitter) || b.Jitter < 0 || b.Jitter > 1 {
		return configError("backoff jitter should be between 0 and 1, got %v", b.Jitter)
	}
	return nil
}

// RemoveOnFinish controls the automatic removal of completed or failed jobs.
//
// Use [RemoveAll], [KeepCount] or [KeepAge] to construct a value, or set
// Count, Age and Limit directly; the zero value keeps every finished job. It
// is stored in the three forms the other BullMQ ports write: a boolean
// (RemoveAll is stored as true), a count (KeepCount), or a {count, age,
// limit} object.
type RemoveOnFinish struct {
	// Count keeps at most Count finished jobs. A value of 0 removes the job
	// straight away.
	Count *int64 `json:"count,omitempty"`
	// Age keeps finished jobs younger than Age seconds.
	Age *int64 `json:"age,omitempty"`
	// Limit caps how many jobs a single cleanup pass may remove.
	Limit *int64 `json:"limit,omitempty"`

	form removeForm
}

// removeForm is how a removal policy is written.
type removeForm uint8

const (
	removeFormObject removeForm = iota
	removeFormBool
	removeFormCount
	// removeFormInvalid marks a stored value no port writes; it is ignored.
	removeFormInvalid
)

// RemoveAll removes jobs as soon as they finish. It is stored as true, as
// the other ports store `removeOnComplete: true`.
func RemoveAll() *RemoveOnFinish {
	zero := int64(0)
	return &RemoveOnFinish{Count: &zero, form: removeFormBool}
}

// KeepCount keeps at most n finished jobs. It is stored as the number n, as
// the other ports store `removeOnComplete: n`.
func KeepCount(n int64) *RemoveOnFinish {
	return &RemoveOnFinish{Count: &n, form: removeFormCount}
}

// KeepAge keeps finished jobs younger than seconds.
func KeepAge(seconds int64) *RemoveOnFinish {
	return &RemoveOnFinish{Age: &seconds}
}

// IsRemoveAll reports whether r is the boolean form true ([RemoveAll]): each
// job is removed as soon as it finishes, without trimming the other finished
// jobs. Backends that tell "remove this job" from "keep no finished job"
// apart (the shared PostgreSQL commands do) must check it rather than Count.
func (r *RemoveOnFinish) IsRemoveAll() bool {
	return r != nil && r.form == removeFormBool && r.Count != nil && *r.Count == 0
}

// MarshalJSON writes r in the form it was built or read in: true or false,
// a count, or an object. A count whose Age or Limit was set afterwards is
// written as an object, so they are kept.
func (r RemoveOnFinish) MarshalJSON() ([]byte, error) {
	switch r.form {
	case removeFormBool:
		return json.Marshal(r.Count != nil && *r.Count == 0)
	case removeFormCount:
		if r.Count != nil && r.Age == nil && r.Limit == nil {
			return json.Marshal(*r.Count)
		}
	case removeFormInvalid:
		return []byte("null"), nil
	}
	type fields RemoveOnFinish
	return json.Marshal(fields(r))
}

// UnmarshalJSON accepts the boolean, numeric and object forms written by the
// other BullMQ ports. Fractional counts are rounded away from zero, so they
// keep their meaning (a positive count stays positive, a negative one keeps
// every job), fractional ages are rounded up and negative ages are ignored.
// Any other value is ignored, as if the option were not set.
func (r *RemoveOnFinish) UnmarshalJSON(data []byte) error {
	*r = RemoveOnFinish{}
	var v any
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	switch t := v.(type) {
	case bool:
		r.form = removeFormBool
		if t {
			zero := int64(0)
			r.Count = &zero
		}
	case float64:
		r.form = removeFormCount
		r.Count = roundAwayFromZero(t)
		if r.Count == nil {
			r.form = removeFormInvalid
		}
	case map[string]any:
		r.Count = numberField(t, "count", roundAwayFromZero)
		r.Age = numberField(t, "age", func(f float64) *int64 {
			if n := roundAwayFromZero(f); n != nil && *n >= 0 {
				return n
			}
			return nil
		})
		r.Limit = numberField(t, "limit", roundAwayFromZero)
	default:
		r.form = removeFormInvalid
	}
	return nil
}

func numberField(m map[string]any, key string, convert func(float64) *int64) *int64 {
	f, ok := m[key].(float64)
	if !ok {
		return nil
	}
	return convert(f)
}

// roundAwayFromZero converts a JSON number to an int64, rounding fractions
// away from zero (0.5 -> 1, -0.5 -> -1) and saturating out-of-range values.
// It returns nil for NaN.
func roundAwayFromZero(f float64) *int64 {
	if math.IsNaN(f) {
		return nil
	}
	if f < 0 {
		f = math.Floor(f)
	} else {
		f = math.Ceil(f)
	}
	var n int64
	switch {
	case f >= math.MaxInt64:
		n = math.MaxInt64
	case f <= math.MinInt64:
		n = math.MinInt64
	default:
		n = int64(f)
	}
	return &n
}

// Progress is a job progress value: either a number or an arbitrary JSON value.
type Progress struct {
	raw json.RawMessage
}

// NumberProgress builds a numeric progress value. It returns an error for NaN
// and infinite values, which have no JSON representation.
func NumberProgress(v float64) (Progress, error) {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return Progress{}, configError("progress must be a finite number, got %v", v)
	}
	return Progress{raw: json.RawMessage(strconv.FormatFloat(v, 'f', -1, 64))}, nil
}

// JSONProgress builds a structured progress value.
func JSONProgress(v any) (Progress, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return Progress{}, err
	}
	return Progress{raw: raw}, nil
}

// Raw returns the JSON encoding of the progress value.
func (p Progress) Raw() string {
	if len(p.raw) == 0 {
		return "0"
	}
	return string(p.raw)
}

// Number returns the progress as a float. It reports false when the progress is
// not a plain number.
func (p Progress) Number() (float64, bool) {
	// Decoding into json.Number would also accept quoted strings such as
	// "42", so check the actual JSON type instead.
	var v any
	if err := json.Unmarshal(p.rawOrZero(), &v); err != nil {
		return 0, false
	}
	n, ok := v.(float64)
	return n, ok
}

// Decode unmarshals a structured progress value into out.
func (p Progress) Decode(out any) error {
	return json.Unmarshal(p.rawOrZero(), out)
}

func (p Progress) rawOrZero() json.RawMessage {
	if len(p.raw) == 0 {
		return json.RawMessage("0")
	}
	return p.raw
}

// MarshalJSON implements json.Marshaler.
func (p Progress) MarshalJSON() ([]byte, error) { return p.rawOrZero(), nil }

// UnmarshalJSON implements json.Unmarshaler.
func (p *Progress) UnmarshalJSON(data []byte) error {
	p.raw = append(json.RawMessage(nil), data...)
	return nil
}

// JobCounts holds the number of jobs per state.
type JobCounts map[JobState]int64

// RateLimiter throttles how many jobs a worker may process per time window.
type RateLimiter struct {
	// Max is the maximum number of jobs per Duration.
	Max int64
	// Duration is the rate limit window. It is stored with millisecond
	// precision, so sub-millisecond values are rounded down.
	Duration time.Duration
}

// MetricsOptions enables the collection of completed/failed counters.
type MetricsOptions struct {
	// MaxDataPoints is the number of one-minute data points to retain.
	MaxDataPoints int64
}

// Metrics is the result of Queue.Metrics.
type Metrics struct {
	// Count is the total number of jobs recorded.
	Count int64
	// PrevCount is the job count at the last time a data point was recorded.
	// It is internal metrics state used to compute the next data point's
	// delta, not a retention boundary.
	PrevCount int64
	// PrevTS is the timestamp (Unix milliseconds) of the transition that last
	// recorded a data point, i.e. the previous collection timestamp. It is
	// internal metrics state, not the timestamp of the oldest retained data
	// point, so do not use it as the retention boundary.
	PrevTS int64
	// Data holds one entry per minute, most recent first: the number of
	// jobs recorded in that minute. Entries are added when a job is
	// recorded in a later minute than the previous entry, so Data stays
	// empty during the first minute of collection, as in Node.js.
	Data []int64
	// NumPoints is the total number of retained data points, regardless of
	// the requested [start, end] window. Use it for pagination (the reference
	// getMetrics API returns it as `count`).
	NumPoints int64
}
