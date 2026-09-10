package bullmq

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strconv"

	"github.com/redis/go-redis/v9"
)

// randomID returns a 128-bit random identifier, used for worker ids and lock
// tokens.
func randomID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand never fails on the platforms Go supports.
		panic(err)
	}
	return hex.EncodeToString(b[:])
}

// client bundles the Redis connection with the key generator shared by
// Queue, Worker, QueueEvents and Job.
type client struct {
	rdb   redis.UniversalClient
	keys  *Keys
	owned bool
}

func newClient(name, prefix string, opts RedisOptions) (*client, error) {
	keys, err := NewKeys(name, prefix)
	if err != nil {
		return nil, err
	}
	rdb, owned := opts.build()
	return &client{rdb: rdb, keys: keys, owned: owned}, nil
}

// close releases the connection when this client created it.
func (c *client) close() error {
	if c.owned {
		return c.rdb.Close()
	}
	return nil
}

// runScript evaluates a shared Lua command.
func (c *client) runScript(ctx context.Context, name string, keys []string, args ...any) (any, error) {
	s, err := getScript(name)
	if err != nil {
		return nil, err
	}
	res, err := s.run(ctx, c.rdb, keys, args...).Result()
	if err == redis.Nil {
		return nil, nil
	}
	return res, err
}

// runScriptStatus evaluates a command that returns a numeric status code and
// converts negative codes into errors.
func (c *client) runScriptStatus(ctx context.Context, name string, keys []string, args ...any) error {
	res, err := c.runScript(ctx, name, keys, args...)
	if err != nil {
		return err
	}
	code, ok := asInt64(res)
	if ok && code < 0 {
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
