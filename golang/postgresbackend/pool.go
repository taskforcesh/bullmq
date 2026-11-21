package postgresbackend

import (
	"context"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/jackc/pgx/v5/pgxpool"
)

// sharedPool is a query pool shared by every backend of the process built
// with the same connection string, schema and pool size, so all queues,
// workers and queue events listeners draw from one bounded pool.
//
// Pools live for the rest of the process once created, like the type and
// statement caches they hold. When the last backend using one closes, its
// idle connections are closed so it holds no server sessions.
type sharedPool struct {
	pool *pgxpool.Pool
	// users counts the open backends. It only changes under poolsMu; it is
	// atomic so the check after every operation is lock free.
	users atomic.Int64
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
	// Connections are opened on demand. A minimum would make the pool's
	// health check reopen sessions after the last backend closed and the pool
	// was cleared, leaving sessions nobody uses.
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
		sp.users.Add(1)
		return sp, nil
	}
	// NewWithConfig does not connect: connections are opened on demand.
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		return nil, configError("invalid PostgreSQL pool configuration: %v", err)
	}
	sp := &sharedPool{pool: pool}
	sp.users.Store(1)
	pools[key] = sp
	return sp, nil
}

// release unregisters a user. When none is left the pool's idle connections
// are closed; connections still running a query are closed when they are
// returned, so this never interrupts an in-flight operation.
func (sp *sharedPool) release() {
	poolsMu.Lock()
	defer poolsMu.Unlock()
	if sp.users.Add(-1) == 0 {
		sp.pool.Reset()
	}
}

// clearIfUnused runs after every operation. An operation that was waiting for
// a pool slot when the last user closed opens a fresh connection after that
// close's reset and would leave it idle in the pool, owned by nobody; close
// it too. The pool is left alone when it was acquired again meanwhile.
func (sp *sharedPool) clearIfUnused() {
	if sp.users.Load() != 0 {
		return
	}
	poolsMu.Lock()
	defer poolsMu.Unlock()
	if sp.users.Load() == 0 {
		sp.pool.Reset()
	}
}
