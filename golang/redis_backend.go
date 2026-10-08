package bullmq

import (
	"context"
	"errors"
	"io"
	"net"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// blockingReadSlack is added to the longest blocking read to size the socket
// read timeout of the dedicated blocking client.
const blockingReadSlack = 10 * time.Second

// RedisBackend is the [Backend] implementation that stores queues in Redis and
// drives every state transition through the Lua commands shared by all BullMQ
// language ports.
//
// Everything Redis specific lives in the redis_*.go files: key names, Lua
// script arguments, msgpack encoding and reply parsing.
type RedisBackend struct {
	rdb   redis.UniversalClient
	owned bool
	keys  *Keys

	// blocking is the client used for BZPOPMIN and XREAD. When the caller asks
	// for a dedicated blocking connection it is a single-connection client
	// (blockingOwned == true) so a blocked read never starves the shared pool
	// and CLIENT SETNAME reliably applies to the connection the blocking
	// command runs on. Otherwise it is the shared client.
	blocking      redis.UniversalClient
	blockingOwned bool
}

var _ Backend = (*RedisBackend)(nil)

// RedisBackendFactory returns a [BackendFactory] that builds [RedisBackend]s
// connected according to opts. It is what Queue, Worker and QueueEvents use
// when no explicit Backend is configured.
func RedisBackendFactory(opts RedisOptions) BackendFactory {
	return func(name string, bo BackendOptions) (Backend, error) {
		return NewRedisBackend(name, opts, bo)
	}
}

// NewRedisBackend creates a Redis backend for the queue called name.
func NewRedisBackend(name string, redisOpts RedisOptions, opts BackendOptions) (*RedisBackend, error) {
	keys, err := NewKeys(name, opts.Prefix)
	if err != nil {
		return nil, err
	}
	rdb, owned := redisOpts.build()
	b := &RedisBackend{rdb: rdb, owned: owned, keys: keys, blocking: rdb}
	if opts.WithBlockingConnection {
		b.blocking, b.blockingOwned = redisOpts.buildBlocking(
			keys.ClientName(opts.ClientNameSuffix), opts.BlockTimeout+blockingReadSlack)
	}
	return b, nil
}

// Client returns the underlying Redis client.
func (b *RedisBackend) Client() redis.UniversalClient { return b.rdb }

// Keys returns the key generator used by the backend.
func (b *RedisBackend) Keys() *Keys { return b.keys }

// Close releases the connections the backend created. Clients supplied by the
// caller are left open.
func (b *RedisBackend) Close() error {
	var firstErr error
	if b.blockingOwned {
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
func (b *RedisBackend) SetName(ctx context.Context, name string) error {
	if b.blockingOwned {
		return nil
	}
	return b.blocking.Do(ctx, "client", "setname", name).Err()
}

// IsTransientError reports whether err is a connectivity or server
// availability problem that is worth retrying.
func (b *RedisBackend) IsTransientError(err error) bool { return isTransientRedisError(err) }

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
	return false
}

// QueueName returns the bare queue name.
func (b *RedisBackend) QueueName() string { return b.keys.Name() }

// QualifiedName returns `{prefix}:{queue}`.
func (b *RedisBackend) QualifiedName() string { return b.keys.Base() }

// ClientName returns `{prefix}:{base64(queue)}{suffix}`.
func (b *RedisBackend) ClientName(suffix string) string { return b.keys.ClientName(suffix) }

// runScript evaluates a shared Lua command.
func (b *RedisBackend) runScript(ctx context.Context, name string, keys []string, args ...any) (any, error) {
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
func (b *RedisBackend) runScriptStatus(ctx context.Context, name string, keys []string, args ...any) error {
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
func luaStateName(state JobState) string {
	if state == StateWaiting {
		return "wait"
	}
	return string(state)
}
