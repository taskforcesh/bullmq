package bullmq

import (
	"encoding/base64"
	"strings"
)

// DefaultPrefix is the Redis key prefix used by BullMQ across every language port.
const DefaultPrefix = "bull"

// Keys generates every Redis key used by a queue.
//
// All keys follow the `{prefix}:{queueName}:{suffix}` pattern so that Go
// workers interoperate with the Node.js, Python, Rust, Elixir and .NET ports.
type Keys struct {
	prefix string
	name   string
	base   string
}

// NewKeys builds a key generator. An empty prefix falls back to [DefaultPrefix].
func NewKeys(name, prefix string) (*Keys, error) {
	if err := validateQueueName(name); err != nil {
		return nil, err
	}
	if prefix == "" {
		prefix = DefaultPrefix
	}
	return &Keys{prefix: prefix, name: name, base: prefix + ":" + name}, nil
}

func validateQueueName(name string) error {
	if name == "" {
		return configError("queue name must be provided")
	}
	if strings.Contains(name, ":") {
		return configError("queue name cannot contain ':'")
	}
	return nil
}

// resolveParentQueueKey accepts either a bare queue name or an already
// qualified `{prefix}:{queueName}` key and returns the qualified form.
func resolveParentQueueKey(prefix, queue string) (string, error) {
	if prefix == "" {
		prefix = DefaultPrefix
	}
	if rest, ok := strings.CutPrefix(queue, prefix+":"); ok {
		if err := validateQueueName(rest); err != nil {
			return "", err
		}
		return queue, nil
	}
	if err := validateQueueName(queue); err != nil {
		return "", err
	}
	return prefix + ":" + queue, nil
}

// Prefix returns the configured key prefix.
func (k *Keys) Prefix() string { return k.prefix }

// Name returns the queue name.
func (k *Keys) Name() string { return k.name }

// Base returns `{prefix}:{name}`.
func (k *Keys) Base() string { return k.base }

// KeyPrefix returns `{prefix}:{name}:`, the value passed to Lua scripts as the
// key prefix argument.
func (k *Keys) KeyPrefix() string { return k.base + ":" }

// Get returns `{prefix}:{name}:{suffix}`.
func (k *Keys) Get(suffix string) string { return k.base + ":" + suffix }

// Job returns the hash key holding a job's fields.
func (k *Keys) Job(jobID string) string { return k.base + ":" + jobID }

// JobLock returns the lock key for a job.
func (k *Keys) JobLock(jobID string) string { return k.base + ":" + jobID + ":lock" }

// JobLogs returns the list key holding a job's logs.
func (k *Keys) JobLogs(jobID string) string { return k.base + ":" + jobID + ":logs" }

// Wait returns the `wait` list key.
func (k *Keys) Wait() string { return k.Get("wait") }

// Active returns the `active` list key.
func (k *Keys) Active() string { return k.Get("active") }

// Paused returns the `paused` list key.
func (k *Keys) Paused() string { return k.Get("paused") }

// Delayed returns the `delayed` sorted set key.
func (k *Keys) Delayed() string { return k.Get("delayed") }

// Prioritized returns the `prioritized` sorted set key.
func (k *Keys) Prioritized() string { return k.Get("prioritized") }

// Completed returns the `completed` sorted set key.
func (k *Keys) Completed() string { return k.Get("completed") }

// Failed returns the `failed` sorted set key.
func (k *Keys) Failed() string { return k.Get("failed") }

// WaitingChildren returns the `waiting-children` sorted set key.
func (k *Keys) WaitingChildren() string { return k.Get("waiting-children") }

// Stalled returns the `stalled` set key.
func (k *Keys) Stalled() string { return k.Get("stalled") }

// StalledCheck returns the key storing the last stalled check timestamp.
func (k *Keys) StalledCheck() string { return k.Get("stalled-check") }

// Limiter returns the rate limiter key.
func (k *Keys) Limiter() string { return k.Get("limiter") }

// Events returns the events stream key.
func (k *Keys) Events() string { return k.Get("events") }

// Meta returns the queue metadata hash key.
func (k *Keys) Meta() string { return k.Get("meta") }

// Marker returns the marker key used to wake up blocked workers.
func (k *Keys) Marker() string { return k.Get("marker") }

// PC returns the priority counter key.
func (k *Keys) PC() string { return k.Get("pc") }

// ID returns the job id counter key.
func (k *Keys) ID() string { return k.Get("id") }

// Repeat returns the job scheduler (repeat) key.
func (k *Keys) Repeat() string { return k.Get("repeat") }

// Metrics returns the metrics key for the given finished state.
func (k *Keys) Metrics(state string) string { return k.Get("metrics:" + state) }

// Dependencies returns the dependency set key of a parent job.
func (k *Keys) Dependencies(jobID string) string { return k.Job(jobID) + ":dependencies" }

// ClientName returns the `CLIENT SETNAME` value used by workers, matching the
// Node.js format `{prefix}:{base64(queueName)}{suffix}`.
func (k *Keys) ClientName(suffix string) string {
	return k.prefix + ":" + base64.StdEncoding.EncodeToString([]byte(k.name)) + suffix
}
