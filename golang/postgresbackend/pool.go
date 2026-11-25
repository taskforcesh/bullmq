package postgresbackend

import (
	"context"
	"strconv"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
)

// sharedPool is a query pool shared by every backend of the process built
// with the same connection string, schema and pool size, so all queues,
// workers and queue events listeners draw from one bounded pool.
//
// When the last backend using a pool closes, the pool leaves the cache and is
// closed as soon as no operation is running on it, so a process that opens
// and closes backends for many schemas or servers does not accumulate pools.
// A backend opened later with the same settings creates a new pool.
type sharedPool struct {
	key  string
	pool *pgxpool.Pool

	mu sync.Mutex
	// users counts the open backends, active the operations running on the
	// pool. The pool is closed once users and active are both zero.
	users  int
	active int
	closed bool
}

var (
	poolsMu sync.Mutex
	pools   = map[string]*sharedPool{}
)

// acquireSharedPool returns the pool for connString, schema and poolSize,
// creating it on first use, and registers one more user.
func acquireSharedPool(connString, schema string, poolSize int) (*sharedPool, error) {
	cfg, err := pgxpool.ParseConfig(connString)
	if err != nil {
		return nil, configError("invalid PostgreSQL connection string: %v", err)
	}
	switch {
	case poolSize > 0:
		cfg.MaxConns = int32(poolSize)
	case !strings.Contains(connString, "pool_max_conns"):
		cfg.MaxConns = DefaultPoolSize
	}
	// Connections are opened on demand, so an idle pool holds no sessions.
	cfg.MinConns = 0
	cfg.MinIdleConns = 0
	// Every pooled session resolves the unqualified names of the shared SQL
	// in the schema. The value is quoted to match the case-preserving
	// CREATE SCHEMA of the migrations.
	cfg.ConnConfig.RuntimeParams["search_path"] = quoteIdent(schema)

	key := connString + "\x00" + schema + "\x00" + strconv.Itoa(int(cfg.MaxConns))

	poolsMu.Lock()
	defer poolsMu.Unlock()
	if sp := pools[key]; sp != nil {
		sp.mu.Lock()
		sp.users++
		sp.mu.Unlock()
		return sp, nil
	}
	// NewWithConfig does not connect: connections are opened on demand.
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		return nil, configError("invalid PostgreSQL pool configuration: %v", err)
	}
	sp := &sharedPool{key: key, pool: pool, users: 1}
	pools[key] = sp
	return sp, nil
}

// release unregisters a user. The last one removes the pool from the cache,
// and closes it unless an operation is still running; that operation closes
// it when it ends, so an in-flight operation is never interrupted.
func (sp *sharedPool) release() {
	poolsMu.Lock()
	sp.mu.Lock()
	sp.users--
	if sp.users == 0 && pools[sp.key] == sp {
		delete(pools, sp.key)
	}
	closeNow := sp.closeIfUnusedLocked()
	sp.mu.Unlock()
	poolsMu.Unlock()
	if closeNow {
		sp.close()
	}
}

// begin registers an operation. It reports false when the pool is already
// closed, which only happens when the backend was closed meanwhile.
func (sp *sharedPool) begin() bool {
	sp.mu.Lock()
	defer sp.mu.Unlock()
	if sp.closed {
		return false
	}
	sp.active++
	return true
}

// end unregisters an operation, closing the pool when it was the last thing
// using it.
func (sp *sharedPool) end() {
	sp.mu.Lock()
	sp.active--
	closeNow := sp.closeIfUnusedLocked()
	sp.mu.Unlock()
	if closeNow {
		sp.close()
	}
}

// closeIfUnusedLocked marks the pool closed when nothing uses it and reports
// whether the caller must close it. sp.mu must be held.
func (sp *sharedPool) closeIfUnusedLocked() bool {
	if sp.closed || sp.users > 0 || sp.active > 0 {
		return false
	}
	sp.closed = true
	return true
}

// close closes the pool in the background: Close waits for connections a
// caller acquired through Backend.Pool to be released, which must not block
// Backend.Close.
func (sp *sharedPool) close() { go sp.pool.Close() }
