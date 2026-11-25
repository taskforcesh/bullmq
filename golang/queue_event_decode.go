package bullmq

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"time"
)

// The fields of an event are strings, as in the Redis stream. These helpers
// parse the ones Node's QueueEvents parses: the returnvalue of completed
// (JSON), the data of progress (JSON) and the delay of delayed (a number).

// DecodeReturnValue decodes the JSON return value of a `completed` event
// into out, as Job.DecodeReturnValue does. It does nothing when the event
// has none.
func (e QueueEvent) DecodeReturnValue(out any) error {
	raw := e.Data["returnvalue"]
	if raw == "" {
		return nil
	}
	return json.Unmarshal([]byte(raw), out)
}

// Progress returns the progress value of a `progress` event: a number or
// any JSON value, read with Progress.Number or Progress.Decode.
func (e QueueEvent) Progress() (Progress, error) {
	raw, ok := e.Data["data"]
	if !ok || !json.Valid([]byte(raw)) {
		return Progress{}, fmt.Errorf("bullmq: %s event %s has no JSON progress data", e.Event, e.ID)
	}
	return Progress{raw: json.RawMessage(raw)}, nil
}

// DecodeProgress decodes the progress value of a `progress` event into out.
func (e QueueEvent) DecodeProgress(out any) error {
	p, err := e.Progress()
	if err != nil {
		return err
	}
	return p.Decode(out)
}

// DelayedUntil returns when the job of a `delayed` event becomes due: its
// delay field, which holds Unix milliseconds rather than a duration, as in
// Node.js. ok is false when the event has no such field.
func (e QueueEvent) DelayedUntil() (t time.Time, ok bool) {
	ms, err := strconv.ParseInt(e.Data["delay"], 10, 64)
	if err != nil {
		f, ferr := strconv.ParseFloat(e.Data["delay"], 64)
		if ferr != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return time.Time{}, false
		}
		ms = int64(f)
	}
	return time.UnixMilli(ms), true
}
