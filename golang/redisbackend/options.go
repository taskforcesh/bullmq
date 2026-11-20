package redisbackend

import (
	"context"
	"errors"
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
	// AutoPipeline, when set, sends the backend's non-blocking commands (the
	// Lua commands, job and metadata reads) through go-redis's automatic
	// pipeliner, which writes the commands that concurrent goroutines issue at
	// the same time together, so a worker with Concurrency > 1, or many
	// goroutines adding jobs, needs fewer round trips per job. Set FullDuplex:
	// go-redis's default (half-duplex) mode runs one batch at a time, which
	// was slower than no auto-pipelining in our benchmarks. Blocking reads
	// (BZPOPMIN, XREAD) never go through it.
	//
	// The pipeliner comes from the client (AutoPipelineWithOptions). With a
	// caller-supplied Client it is the client's shared instance: every backend
	// built on that client uses it, the options of whoever creates it first
	// apply, and the backend leaves it open, since it belongs to the client
	// and closing it would stop it for all of them. Clients that cannot
	// auto-pipeline (*redis.Ring) run unpipelined.
	//
	// EXPERIMENTAL: go-redis's auto-pipelining API may change in a minor
	// release. A queued command does not observe its context's cancellation
	// or deadline: the backend does not send a command whose context is
	// already done, but once queued it runs, bounded by the client's read and
	// write timeouts. After a connection error go-redis sends again, up to the
	// client's MaxRetries, the commands whose replies it did not read (in
	// half-duplex mode the whole batch); see the README for what that means
	// for job state.
	AutoPipeline *redis.AutoPipelineOptions
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

// autoPipeliner returns the client's auto-pipeliner for opts, or nil when the
// client cannot auto-pipeline.
func autoPipeliner(rdb redis.UniversalClient, opts *redis.AutoPipelineOptions) (*redis.AutoPipeliner, error) {
	ap, err := rdb.AutoPipelineWithOptions(opts)
	if errors.Is(err, redis.ErrRingAutoPipelineUnsupported) {
		return nil, nil
	}
	if err != nil {
		return nil, configError("redis auto-pipelining: %v", err)
	}
	return ap, nil
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
// A *redis.ClusterClient is cloned the same way, with one connection per
// node. Other supplied clients (ring, ...) cannot be cloned; they are reused
// as-is, the returned tracker is nil, and callers must use go-redis's
// timeout-aware typed blocking commands and treat the name as best-effort.
//
// A dedicated client comes with a connTracker, which interrupts a blocked
// read by closing the connection. The tracker is nil for a reused client,
// which is not owned and must not be closed by the caller.
func (o Options) buildBlocking(name string, readTimeout time.Duration) (redis.UniversalClient, *connTracker) {
	if readTimeout <= 0 {
		readTimeout = -1
	}
	if cluster, ok := o.Client.(*redis.ClusterClient); ok {
		return buildBlockingCluster(cluster, name, readTimeout)
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

// buildBlockingCluster derives a dedicated blocking client from a cluster
// client's options, as buildBlocking does for a *redis.Client: one
// connection per node, named, with the blocking read timeout. One connection
// per node also lists a worker once per node in CLIENT LIST.
func buildBlockingCluster(c *redis.ClusterClient, name string, readTimeout time.Duration) (redis.UniversalClient, *connTracker) {
	clone := *c.Options()
	clone.PoolSize = 1
	clone.MinIdleConns = 0
	clone.MaxIdleConns = 0
	clone.MaxActiveConns = 0
	clone.ReadTimeout = readTimeout
	clone.ContextTimeoutEnabled = true
	clone.ClientName = name
	// See buildBlocking.
	clone.PushNotificationProcessor = nil
	clone.AutoPipelineOptions = nil
	tracker := &connTracker{}
	newNode := clone.NewClient
	clone.NewClient = func(opt *redis.Options) *redis.Client {
		var node *redis.Client
		if newNode != nil {
			node = newNode(opt)
		} else {
			node = redis.NewClient(opt)
		}
		node.AddHook(tracker)
		return node
	}
	return redis.NewClusterClient(&clone), tracker
}

// connTracker remembers the connections of a dedicated blocking client, which
// has at most one per server, so that a blocked read can be interrupted by
// closing them, as Node's disconnectBlocking does. The client then drops the
// connection and dials (and names) a new one for its next command.
type connTracker struct {
	mu    sync.Mutex
	conns map[string]net.Conn
}

func (t *connTracker) DialHook(next redis.DialHook) redis.DialHook {
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		conn, err := next(ctx, network, addr)
		if err == nil {
			t.mu.Lock()
			if t.conns == nil {
				t.conns = make(map[string]net.Conn)
			}
			t.conns[addr] = conn
			t.mu.Unlock()
		}
		return conn, err
	}
}

func (t *connTracker) ProcessHook(next redis.ProcessHook) redis.ProcessHook { return next }

func (t *connTracker) ProcessPipelineHook(next redis.ProcessPipelineHook) redis.ProcessPipelineHook {
	return next
}

// interrupt closes the current connections, failing any read blocked on
// them.
func (t *connTracker) interrupt() {
	t.mu.Lock()
	conns := t.conns
	t.conns = nil
	t.mu.Unlock()
	for _, conn := range conns {
		_ = conn.Close()
	}
}
