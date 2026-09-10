package bullmq

import (
	"encoding/json"
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
	// worker's Settings.BackoffStrategy callback.
	Type BackoffType `json:"type"`
	// Delay is the base delay in milliseconds.
	Delay int64 `json:"delay,omitempty"`
}

func (b *Backoff) writeMsgpack(w *msgpackWriter) {
	w.MapLen(2)
	w.Str("type")
	w.Str(string(b.Type))
	w.Str("delay")
	w.Uint(uint64(b.Delay))
}

// RemoveOnFinish controls the automatic removal of completed or failed jobs.
//
// Use [RemoveAll], [KeepCount] or [KeepAge] to construct a value; the zero
// value keeps every finished job.
type RemoveOnFinish struct {
	// Count keeps at most Count finished jobs. A value of 0 removes the job
	// straight away.
	Count *int64 `json:"count,omitempty"`
	// Age keeps finished jobs younger than Age seconds.
	Age *int64 `json:"age,omitempty"`
	// Limit caps how many jobs a single cleanup pass may remove.
	Limit *int64 `json:"limit,omitempty"`
}

// RemoveAll removes jobs as soon as they finish.
func RemoveAll() *RemoveOnFinish {
	zero := int64(0)
	return &RemoveOnFinish{Count: &zero}
}

// KeepCount keeps at most n finished jobs.
func KeepCount(n int64) *RemoveOnFinish {
	return &RemoveOnFinish{Count: &n}
}

// KeepAge keeps finished jobs younger than seconds.
func KeepAge(seconds int64) *RemoveOnFinish {
	return &RemoveOnFinish{Age: &seconds}
}

func (r *RemoveOnFinish) writeMsgpack(w *msgpackWriter) {
	n := 0
	for _, v := range []*int64{r.Count, r.Age, r.Limit} {
		if v != nil {
			n++
		}
	}
	w.MapLen(n)
	if r.Count != nil {
		w.Str("count")
		w.Int(*r.Count)
	}
	if r.Age != nil {
		w.Str("age")
		w.Int(*r.Age)
	}
	if r.Limit != nil {
		w.Str("limit")
		w.Int(*r.Limit)
	}
}

// UnmarshalJSON accepts the boolean, numeric and object forms written by the
// other BullMQ ports.
func (r *RemoveOnFinish) UnmarshalJSON(data []byte) error {
	var b bool
	if err := json.Unmarshal(data, &b); err == nil {
		if b {
			zero := int64(0)
			r.Count = &zero
		}
		return nil
	}
	var n int64
	if err := json.Unmarshal(data, &n); err == nil {
		r.Count = &n
		return nil
	}
	type alias RemoveOnFinish
	return json.Unmarshal(data, (*alias)(r))
}

// Progress is a job progress value: either a number or an arbitrary JSON value.
type Progress struct {
	raw json.RawMessage
}

// NumberProgress builds a numeric progress value.
func NumberProgress(v float64) Progress {
	return Progress{raw: json.RawMessage(strconv.FormatFloat(v, 'f', -1, 64))}
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
	var v float64
	if err := json.Unmarshal(p.rawOrZero(), &v); err != nil {
		return 0, false
	}
	return v, true
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
	// Duration is the rate limit window. Redis stores it with millisecond
	// precision, so sub-millisecond values are rounded down.
	Duration time.Duration
}

// writeMsgpack encodes the limiter as the `{max, duration}` map the Lua
// commands expect.
func (r *RateLimiter) writeMsgpack(w *msgpackWriter) {
	w.MapLen(2)
	w.Str("max")
	w.Uint(uint64(r.Max))
	w.Str("duration")
	w.Uint(uint64(r.Duration.Milliseconds()))
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
	// PrevCount is the number of jobs recorded before the returned window.
	PrevCount int64
	// PrevTS is the timestamp of the oldest retained data point.
	PrevTS int64
	// Data holds one entry per minute, most recent first.
	Data []int64
}
