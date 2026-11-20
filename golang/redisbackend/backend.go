// Package redisbackend is the Redis implementation of [bullmq.Backend].
//
// It stores queues in Redis and drives every state transition through the
// Lua commands shared by all BullMQ language ports, so Go producers and
// workers interoperate with the Node.js, Python, Elixir, PHP, Rust and .NET
// ports on the same queues.
//
//	backend := redisbackend.New(redisbackend.Options{Addr: "127.0.0.1:6379"})
//	queue, err := bullmq.NewQueue("emails", &bullmq.QueueOptions{Backend: backend})
//
// The Lua commands are embedded at build time from the commands directory,
// which is generated from the repository root with:
//
//	yarn generate:raw:scripts && yarn copy:lua:golang
package redisbackend

import (
	"context"
	"errors"
	"io"
	"net"
	"strconv"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// blockingReadSlack is added to the longest blocking read to size the socket
// read timeout of the dedicated blocking client.
const blockingReadSlack = 10 * time.Second

// Backend is the [bullmq.Backend] implementation that stores queues in Redis
// and drives every state transition through the Lua commands shared by all
// BullMQ language ports.
//
// Queue.Backend, for a queue built with [New], returns a *Backend, which gives
// access to the underlying client and key names.
type Backend struct {
	rdb   redis.UniversalClient
	owned bool
	keys  *Keys

	// blocking is the client used for BZPOPMIN and XREAD. When the caller asks
	// for a dedicated blocking connection it is a single-connection client
	// (blockingConn != nil) so a blocked read never starves the shared pool,
	// CLIENT SETNAME reliably applies to the connection the blocking command
	// runs on, and the read can be interrupted by closing that connection.
	// Otherwise it is the shared client.
	blocking     redis.UniversalClient
	blockingConn *connTracker
	// blockTimeout is the longest blocking read requested by the owner
	// (bullmq.BackendOptions.BlockTimeout).
	blockTimeout time.Duration

	// loadedScripts holds the names of the scripts this backend loaded with
	// SCRIPT LOAD for bulk adds. It is cleared when the server reports a
	// script missing from its cache.
	loadedScripts sync.Map
}

var _ bullmq.Backend = (*Backend)(nil)

// New returns a [bullmq.BackendFactory] that builds Redis backends connected
// according to opts. Pass it as the Backend option of bullmq.QueueOptions,
// bullmq.WorkerOptions and bullmq.QueueEventsOptions. Every queue, worker or
// queue events listener built from it gets its own backend; they share the
// connection only when opts.Client is set.
func New(opts Options) bullmq.BackendFactory {
	return func(name string, bo bullmq.BackendOptions) (bullmq.Backend, error) {
		return NewBackend(name, opts, bo)
	}
}

// NewBackend creates a Redis backend for the queue called name. Most callers
// use [New] instead and let bullmq build the backend.
func NewBackend(name string, redisOpts Options, opts bullmq.BackendOptions) (*Backend, error) {
	keys, err := NewKeys(name, redisOpts.Prefix)
	if err != nil {
		return nil, err
	}
	clientName := keys.ClientName(opts.ClientNameSuffix)
	if opts.WithBlockingConnection {
		for _, c := range clientName {
			if c < '!' || c > '~' {
				return nil, configError("redis client name %q must contain only printable ASCII characters without spaces", clientName)
			}
		}
	}
	rdb, owned := redisOpts.build()
	b := &Backend{rdb: rdb, owned: owned, keys: keys, blocking: rdb, blockTimeout: opts.BlockTimeout}
	if opts.WithBlockingConnection {
		b.blocking, b.blockingConn = redisOpts.buildBlocking(
			clientName, opts.BlockTimeout+blockingReadSlack)
	}
	return b, nil
}

// Client returns the underlying Redis client.
func (b *Backend) Client() redis.UniversalClient { return b.rdb }

// Keys returns the key generator used by the backend.
func (b *Backend) Keys() *Keys { return b.keys }

// Close releases the connections the backend created. Clients supplied by the
// caller are left open.
func (b *Backend) Close() error {
	var firstErr error
	if b.blockingConn != nil {
		firstErr = b.blocking.Close()
	}
	if b.owned {
		if err := b.rdb.Close(); firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// SetName names the blocking connection. A dedicated blocking client is
// already named through its OnConnect hook, on the exact connection the
// blocking read runs on; naming a shared client is best-effort only.
func (b *Backend) SetName(ctx context.Context, name string) error {
	if b.blockingConn != nil {
		return nil
	}
	return b.blocking.Do(ctx, "client", "setname", name).Err()
}

// IsTransientError reports whether err is a connectivity or server
// availability problem that is worth retrying.
func (b *Backend) IsTransientError(err error) bool { return isTransientRedisError(err) }

// isTransientRedisError reports whether err is a connectivity or server
// availability problem that is worth retrying, as opposed to a script or
// logic error.
func isTransientRedisError(err error) bool {
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return true
	}
	var netErr net.Error
	if errors.As(err, &netErr) {
		return true
	}
	for _, prefix := range []string{"LOADING", "READONLY", "MASTERDOWN", "CLUSTERDOWN", "TRYAGAIN"} {
		if redis.HasErrorPrefix(err, prefix) {
			return true
		}
	}
	for cause := err; cause != nil; cause = errors.Unwrap(cause) {
		switch cause.Error() {
		case "redis: connection pool timeout", "redis: connection pool exhausted":
			return true
		}
	}
	return false
}

// QueueName returns the bare queue name.
func (b *Backend) QueueName() string { return b.keys.Name() }

// QualifiedName returns `{prefix}:{queue}`.
func (b *Backend) QualifiedName() string { return b.keys.Base() }

// ResolveParent returns the parent reference and `{prefix}:{queue}:{id}` key
// that are stored for a job added under parent.
func (b *Backend) ResolveParent(parent *bullmq.ParentOptions) (*bullmq.ParentKeys, string, error) {
	queueKey, err := resolveParentQueueKey(b.keys.Prefix(), parent.Queue)
	if err != nil {
		return nil, "", err
	}
	return &bullmq.ParentKeys{ID: parent.ID, QueueKey: queueKey}, queueKey + ":" + parent.ID, nil
}

// ClientName returns `{prefix}:{base64(queue)}{suffix}`.
func (b *Backend) ClientName(suffix string) string { return b.keys.ClientName(suffix) }

// runScript evaluates a shared Lua command.
func (b *Backend) runScript(ctx context.Context, name string, keys []string, args ...any) (any, error) {
	s, err := getScript(name)
	if err != nil {
		return nil, err
	}
	res, err := s.run(ctx, b.rdb, keys, args...).Result()
	if err == redis.Nil {
		return nil, nil
	}
	return res, err
}

// runScriptStatus evaluates a command that returns a numeric status code and
// converts negative codes into errors.
func (b *Backend) runScriptStatus(ctx context.Context, name string, keys []string, args ...any) error {
	res, err := b.runScript(ctx, name, keys, args...)
	if err != nil {
		return err
	}
	if code, ok := asInt64(res); ok && code < 0 {
		return scriptError(name, code)
	}
	return nil
}

// asInt64 coerces the loosely typed values returned by go-redis into an int64.
func asInt64(v any) (int64, bool) {
	switch t := v.(type) {
	case int64:
		return t, true
	case int:
		return int64(t), true
	case float64:
		return int64(t), true
	case string:
		n, err := strconv.ParseInt(t, 10, 64)
		return n, err == nil
	case []byte:
		n, err := strconv.ParseInt(string(t), 10, 64)
		return n, err == nil
	default:
		return 0, false
	}
}

// asString coerces a Lua reply into a string.
func asString(v any) (string, bool) {
	switch t := v.(type) {
	case string:
		return t, true
	case []byte:
		return string(t), true
	case int64:
		return strconv.FormatInt(t, 10), true
	default:
		return "", false
	}
}

// asStrings coerces a Lua array reply into a slice of strings, skipping
// anything that is not a string.
func asStrings(v any) []string {
	arr, _ := v.([]any)
	out := make([]string, 0, len(arr))
	for _, e := range arr {
		if s, ok := asString(e); ok {
			out = append(out, s)
		}
	}
	return out
}

// flatToMap converts a flat `field, value, field, value` reply (the shape of
// `HGETALL` inside a Lua script) into a map.
func flatToMap(v any) map[string]string {
	arr, ok := v.([]any)
	if !ok {
		return nil
	}
	out := make(map[string]string, len(arr)/2)
	for i := 0; i+1 < len(arr); i += 2 {
		field, okF := asString(arr[i])
		value, okV := asString(arr[i+1])
		if okF && okV {
			out[field] = value
		}
	}
	return out
}

func boolToStr(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

// luaStateName maps a JobState to the key suffix used by the Lua commands.
func luaStateName(state bullmq.JobState) string {
	if state == bullmq.StateWaiting {
		return "wait"
	}
	return string(state)
}
