package redisbackend

import (
	"bytes"
	"encoding/json"
	"strconv"
	"strings"

	bullmq "github.com/taskforcesh/bullmq-go"
	"github.com/vmihailenco/msgpack/v5"
)

// packMsgpack encodes v as MessagePack for the shared Lua commands, which
// decode their packed arguments with `cmsgpack.unpack`.
//
// It is the counterpart of the `Packr` instance the Node.js implementation
// uses (see src/classes/redis-queue-backend.ts), so the encoder is configured
// to stay on the subset every port agrees on:
//
//   - integers use their smallest representation;
//   - map keys are sorted, so the same options always produce the same bytes;
//   - no extension types are emitted.
//
// Strings must be passed as Go strings, never as []byte, which the encoder
// would write using the `bin` family instead of `str`.
func packMsgpack(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := msgpack.NewEncoder(&buf)
	enc.UseCompactInts(true)
	enc.SetSortMapKeys(true)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// backoffValue builds the stored `{type, delay, jitter}` backoff map. As in
// Node.js, which leaves out an undefined delay, `delay` and `jitter` are only
// added when they are set; the PostgreSQL backend's JSON encoding omits them
// too.
func backoffValue(b *bullmq.Backoff) map[string]any {
	m := map[string]any{"type": string(b.Type)}
	if b.Delay != 0 {
		m["delay"] = b.Delay
	}
	if b.Jitter > 0 {
		m["jitter"] = b.Jitter
	}
	return m
}

// keepJobsValue builds the keep policy map the Lua commands expect. Only the
// fields that were set are included, so an explicit zero count (remove the
// job straight away) is preserved.
func keepJobsValue(r *bullmq.RemoveOnFinish) map[string]any {
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

// removeOnFinishValue returns a removal policy as it is stored in the job
// options, in the form it was given (its JSON form): true or false, a count,
// or a {count, age, limit} map. It returns nil for a policy to leave out.
func removeOnFinishValue(r *bullmq.RemoveOnFinish) (any, error) {
	raw, err := json.Marshal(r)
	if err != nil {
		return nil, err
	}
	switch s := string(raw); {
	case s == "true" || s == "false":
		return s == "true", nil
	case s == "null":
		return nil, nil
	case strings.HasPrefix(s, "{"):
		return keepJobsValue(r), nil
	default:
		return strconv.ParseInt(s, 10, 64)
	}
}

// limiterValue builds the `{max, duration}` map the Lua commands expect.
func limiterValue(r *bullmq.RateLimiter) map[string]any {
	return map[string]any{
		"max":      r.Max,
		"duration": r.Duration.Milliseconds(),
	}
}
