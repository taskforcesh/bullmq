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
	// effective delay is drawn uniformly from [delay*(1-Jitter), delay]. 0
	// (the default) disables jitter. Applies to the fixed and exponential
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

// msgpackValue builds the `{type, delay}` map the Lua commands expect, with
// `jitter` added only when it is enabled.
func (b *Backoff) msgpackValue() map[string]any {
	m := map[string]any{
		"type":  string(b.Type),
		"delay": b.Delay,
	}
	if b.Jitter > 0 {
		m["jitter"] = b.Jitter
	}
	return m
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

// msgpackValue builds the keep policy map the Lua commands expect. Only the
// fields that were set are included, so an explicit zero count (remove the
// job straight away) is preserved.
func (r *RemoveOnFinish) msgpackValue() map[string]any {
	m := make(map[string]any, 3)
	if r.Count != nil {
		m["count"] = *r.Count
	}
	if r.Age != nil {
		m["age"] = *r.Age
	}
	if r.Limit != nil {
		m["limit"] = *r.Limit
	}
	return m
}

// UnmarshalJSON accepts the boolean, numeric and object forms written by the
// other BullMQ ports.
func (r *RemoveOnFinish) UnmarshalJSON(data []byte) error {
	var b bool
	if err := json.Unmarshal(data, &b); err == nil {
		*r = RemoveOnFinish{}
		if b {
			zero := int64(0)
			r.Count = &zero
		}
		return nil
	}
	var n int64
	if err := json.Unmarshal(data, &n); err == nil {
		*r = RemoveOnFinish{Count: &n}
		return nil
	}
	type alias RemoveOnFinish
	var decoded alias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*r = RemoveOnFinish(decoded)
	return nil
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
	var n json.Number
	if err := json.Unmarshal(p.rawOrZero(), &n); err != nil {
		return 0, false
	}
	if n == "" {
		return 0, false
	}
	v, err := n.Float64()
	if err != nil {
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

// msgpackValue builds the `{max, duration}` map the Lua commands expect.
func (r *RateLimiter) msgpackValue() map[string]any {
	return map[string]any{
		"max":      r.Max,
		"duration": r.Duration.Milliseconds(),
	}
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
	// Data holds one entry per minute, most recent first.
	Data []int64
	// NumPoints is the total number of retained data points, regardless of
	// the requested [start, end] window. Use it for pagination (the reference
	// getMetrics API returns it as `count`).
	NumPoints int64
}
