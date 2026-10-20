package bullmq

import (
	"time"

	"github.com/redis/go-redis/v9"
)

// RedisOptions describes how to reach the Redis server.
//
// Set Client to reuse an existing go-redis client; otherwise Addr and the
// remaining fields are used to build one.
type RedisOptions struct {
	// Client is an existing client to reuse. When set every other field is ignored.
	Client redis.UniversalClient
	// Addr is the `host:port` of the Redis server. Defaults to 127.0.0.1:6379.
	Addr string
	// Username for ACL authentication.
	Username string
	// Password for authentication.
	Password string
	// DB is the database index.
	DB int
	// PoolSize is the maximum number of pooled connections.
	PoolSize int
}

func (o RedisOptions) build() (redis.UniversalClient, bool) {
	if o.Client != nil {
		return o.Client, false
	}
	addr := o.Addr
	if addr == "" {
		addr = "127.0.0.1:6379"
	}
	return redis.NewClient(&redis.Options{
		Addr:     addr,
		Username: o.Username,
		Password: o.Password,
		DB:       o.DB,
		PoolSize: o.PoolSize,
	}), true
}

// buildBlocking builds a client dedicated to blocking reads (BZPOPMIN,
// XREAD). Unlike build, it forces a single pooled connection and sets
// go-redis's ClientName option, which issues CLIENT SETNAME on that
// connection (and any reconnect) before it is returned to the pool, so the
// name set here is guaranteed to be the same connection the blocking command
// runs on. A plain CLIENT SETNAME issued once through the pool (as build's
// client would use) can land on a different pooled connection than the one a
// later blocking command acquires, leaving the blocking connection unnamed and
// making Queue.Workers miss or misreport the worker.
//
// readTimeout is the socket read timeout of the dedicated client. It acts as
// a watchdog for raw commands (which carry no per-command timeout metadata in
// go-redis) and must therefore exceed the longest blocking call that will be
// issued through the client; a non-positive value disables it.
//
// When o.Client is a *redis.Client, a dedicated client is derived from its
// options (address, credentials, TLS, dialer, sentinel failover, ...) with a
// single pooled connection, the blocking read timeout and the client name, so
// the caller's default read timeout (3s) never applies to blocking commands.
// Other supplied clients (cluster, ring, ...) cannot be cloned; they are
// reused as-is, the returned bool is false, and callers must use go-redis's
// timeout-aware typed blocking commands and treat the name as best-effort.
//
// The returned bool reports whether the client is dedicated and owned, i.e.
// must be closed by the caller.
func (o RedisOptions) buildBlocking(name string, readTimeout time.Duration) (redis.UniversalClient, bool) {
	if readTimeout <= 0 {
		readTimeout = -1
	}
	if o.Client != nil {
		if c, ok := o.Client.(*redis.Client); ok {
			opt := *c.Options()
			opt.PoolSize = 1
			opt.MinIdleConns = 0
			opt.MaxIdleConns = 0
			opt.MaxActiveConns = 0
			opt.ReadTimeout = readTimeout
			opt.ClientName = name
			return redis.NewClient(&opt), true
		}
		return o.Client, false
	}
	addr := o.Addr
	if addr == "" {
		addr = "127.0.0.1:6379"
	}
	return redis.NewClient(&redis.Options{
		Addr:        addr,
		Username:    o.Username,
		Password:    o.Password,
		DB:          o.DB,
		PoolSize:    1,
		ReadTimeout: readTimeout,
		ClientName:  name,
	}), true
}
