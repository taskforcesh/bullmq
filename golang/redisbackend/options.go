package redisbackend

import (
	"context"
	"net"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// Options configures the Redis backend: how to reach the server and which key
// prefix the queues live under.
//
// Set Client to reuse an existing go-redis client; otherwise Addr and the
// connection fields are used to build one.
type Options struct {
	// Prefix is the key prefix of every queue key. Defaults to [DefaultPrefix]
	// ("bull"), as in every other BullMQ port.
	Prefix string
	// Client is an existing client to reuse. When set, the connection fields
	// below are ignored. The backend never closes a supplied client.
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

func (o Options) build() (redis.UniversalClient, bool) {
	if o.Client != nil {
		return o.Client, false
	}
	addr := o.Addr
	if addr == "" {
		addr = "127.0.0.1:6379"
	}
	return redis.NewClient(&redis.Options{
		Addr:                  addr,
		Username:              o.Username,
		Password:              o.Password,
		DB:                    o.DB,
		PoolSize:              o.PoolSize,
		ContextTimeoutEnabled: true,
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
// A dedicated client comes with a connTracker, which interrupts a blocked
// read by closing the connection. The tracker is nil for a reused client,
// which is not owned and must not be closed by the caller.
func (o Options) buildBlocking(name string, readTimeout time.Duration) (redis.UniversalClient, *connTracker) {
	if readTimeout <= 0 {
		readTimeout = -1
	}
	var opt *redis.Options
	if o.Client != nil {
		c, ok := o.Client.(*redis.Client)
		if !ok {
			return o.Client, nil
		}
		clone := *c.Options()
		clone.PoolSize = 1
		clone.MinIdleConns = 0
		clone.MaxIdleConns = 0
		clone.MaxActiveConns = 0
		clone.ReadTimeout = readTimeout
		clone.ContextTimeoutEnabled = true
		clone.ClientName = name
		// go-redis stores the client's push notification processor in its
		// options; sharing it would make the clone fail to register its own
		// maintenance notification handlers. Client-side caching has nothing to
		// cache on a connection that only blocks, and its cache must not be
		// shared either.
		clone.PushNotificationProcessor = nil
		clone.ClientSideCache = nil
		clone.ClientSideCacheConfig = nil
		opt = &clone
	} else {
		addr := o.Addr
		if addr == "" {
			addr = "127.0.0.1:6379"
		}
		opt = &redis.Options{
			Addr:                  addr,
			Username:              o.Username,
			Password:              o.Password,
			DB:                    o.DB,
			PoolSize:              1,
			ReadTimeout:           readTimeout,
			ClientName:            name,
			ContextTimeoutEnabled: true,
		}
	}
	client := redis.NewClient(opt)
	tracker := &connTracker{}
	client.AddHook(tracker)
	return client, tracker
}

// connTracker remembers the connection of a dedicated blocking client, which
// has at most one, so that a blocked read can be interrupted by closing it,
// as Node's disconnectBlocking does. The client then drops the connection
// and dials (and names) a new one for its next command.
type connTracker struct {
	mu   sync.Mutex
	conn net.Conn
}

func (t *connTracker) DialHook(next redis.DialHook) redis.DialHook {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		conn, err := next(ctx, network, addr)
		if err == nil {
			t.mu.Lock()
			t.conn = conn
			t.mu.Unlock()
		}
		return conn, err
	}
}

func (t *connTracker) ProcessHook(next redis.ProcessHook) redis.ProcessHook { return next }

func (t *connTracker) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return next
}

// interrupt closes the current connection, failing any read blocked on it.
func (t *connTracker) interrupt() {
	t.mu.Lock()
	conn := t.conn
	t.conn = nil
	t.mu.Unlock()
	if conn != nil {
		_ = conn.Close()
	}
}
