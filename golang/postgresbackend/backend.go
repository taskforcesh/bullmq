// Package postgresbackend is the PostgreSQL implementation of
// [bullmq.Backend].
//
// It stores queues in PostgreSQL tables and drives every state transition
// through the SQL shared by all BullMQ language ports (the migrations and
// commands of src/postgres), so Go producers and workers interoperate with
// the Node.js, Python, Elixir and .NET ports on the same schema.
//
//	backend := postgresbackend.New(postgresbackend.Options{
//		ConnString: "postgres://user:pass@localhost:5432/app",
//	})
//	queue, err := bullmq.NewQueue("emails", &bullmq.QueueOptions{Backend: backend})
//
// The schema (default "bullmq") namespaces every queue, as the key prefix
// does on Redis. It is created and migrated on first use, with the migration
// ledger every runtime shares, unless the ledger is up to date or
// Options.SkipMigrations is set; [Migrate] migrates it as a deployment step. Queries run on a pgxpool pool shared by the
// backends of the process with the same settings; workers and queue events
// listeners also hold a dedicated connection for LISTEN.
//
// The SQL files are embedded at build time from the sql directory, which is
// generated from the repository root with:
//
//	yarn copy:sql:golang
package postgresbackend

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	bullmq "github.com/taskforcesh/bullmq-go"
	"github.com/taskforcesh/bullmq-go/internal/queuemeta"
)

const (
	// DefaultSchema is the schema used when Options.Schema is empty.
	DefaultSchema = "bullmq"
	// DefaultPoolSize is the size of the query pool when neither
	// Options.PoolSize nor the connection string's pool_max_conns sets one.
	// The pool is shared by the whole process, so it is larger than a
	// per-queue pool would be, but past about 20 connections extra sessions
	// mostly add lock contention on a queue's hot rows.
	DefaultPoolSize = 20
)

// Options configures the PostgreSQL backends built by [New].
type Options struct {
	// ConnString is the PostgreSQL connection string, as a URL
	// ("postgres://user:pass@host:5432/db") or in keyword/value form. It is
	// required unless Pool is set.
	ConnString string
	// Pool is an optional caller-supplied pool, used as is and never closed
	// by BullMQ. Its connections must already use Schema as their
	// search_path, for example with
	// config.ConnConfig.RuntimeParams["search_path"] = "bullmq", since BullMQ
	// does not change the session state of connections it does not own.
	// PoolSize does not apply to it. Dedicated LISTEN connections are opened
	// with its connection settings, outside the pool and without its
	// OnNotification and OnNotice callbacks.
	Pool *pgxpool.Pool
	// Schema namespaces every queue. Defaults to "bullmq". It must be a
	// plain identifier: letters, digits, underscores and $, starting with a
	// letter or underscore, at most 63 characters.
	Schema string
	// PoolSize is the maximum number of pooled connections used for
	// queries. Defaults to the connection string's pool_max_conns, or
	// DefaultPoolSize. Backends built with the same ConnString, Schema and
	// PoolSize share one pool per process. Its connections are opened on
	// demand and closed once its last backend is closed, so pool_min_conns
	// and pool_min_idle_conns in ConnString are ignored; pass a Pool to keep
	// connections open.
	PoolSize int
	// SkipVersionCheck skips the check that the server runs PostgreSQL 13 or
	// newer.
	SkipVersionCheck bool
	// SkipMigrations stops the backends from migrating the schema: it must
	// already be up to date, migrated with [Migrate] or by another runtime,
	// or the first operation fails. The backends then only read the
	// migration ledger, which suits a role that does not own the schema.
	// Without it, the schema is migrated on first use, which skips every
	// DDL statement when the ledger is up to date.
	SkipMigrations bool
}

// Backend is the [bullmq.Backend] implementation that stores queues in
// PostgreSQL.
//
// Queue.Backend, for a queue built with [New], returns a *Backend, which
// gives access to the query pool and the schema.
type Backend struct {
	name             string
	schema           string
	pool             *pgxpool.Pool
	shared           *sharedPool
	migrateKey       string
	skipVersionCheck bool
	skipMigrations   bool
	serverMajor      int

	ready   atomic.Bool
	readyMu sync.Mutex

	jobs   *listener
	events *listener
	// reportedDelay is the due time of the delayed job WaitForJob reported
	// last.
	reportedDelay atomic.Int64

	closing   chan struct{}
	closeOnce sync.Once

	// meta writes the queue metadata before the first command.
	meta *queuemeta.Writer
}

var _ bullmq.Backend = (*Backend)(nil)

// errClosed is returned by operations started after Close.
var errClosed = errors.New("bullmq: the PostgreSQL backend is closed")

var schemaNameRE = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_$]*$`)

// New returns a [bullmq.BackendFactory] that builds PostgreSQL backends
// according to opts. Pass it as the Backend option of bullmq.QueueOptions,
// bullmq.WorkerOptions and bullmq.QueueEventsOptions.
func New(opts Options) bullmq.BackendFactory {
	return func(name string, bo bullmq.BackendOptions) (bullmq.Backend, error) {
		return NewBackend(name, opts, bo)
	}
}

// NewBackend creates a PostgreSQL backend for the queue called name. Most
// callers use [New] instead and let bullmq build the backend.
//
// It does not connect: the schema is migrated, or checked, by the first
// operation.
func NewBackend(name string, opts Options, bo bullmq.BackendOptions) (*Backend, error) {
	schema := opts.Schema
	if schema == "" {
		schema = DefaultSchema
	}
	if len(schema) > 63 || !schemaNameRE.MatchString(schema) {
		return nil, configError("invalid PostgreSQL schema name %q: use a plain identifier of letters, digits, underscores or $, starting with a letter or underscore, at most 63 characters", schema)
	}
	if opts.PoolSize < 0 {
		return nil, configError("PostgreSQL PoolSize must be at least 1, got %d", opts.PoolSize)
	}

	b := &Backend{
		name:             name,
		schema:           schema,
		skipVersionCheck: opts.SkipVersionCheck,
		skipMigrations:   opts.SkipMigrations,
		closing:          make(chan struct{}),
		meta:             queuemeta.New(bo.QueueMeta),
	}
	switch {
	case opts.Pool != nil:
		b.pool = opts.Pool
		b.migrateKey = opts.Pool.Config().ConnString() + "\x00" + schema
	case opts.ConnString == "":
		return nil, configError("a PostgreSQL ConnString or Pool is required")
	default:
		sp, err := acquireSharedPool(opts.ConnString, schema, opts.PoolSize)
		if err != nil {
			return nil, err
		}
		b.shared = sp
		b.pool = sp.pool
		b.migrateKey = opts.ConnString + "\x00" + schema
	}

	// Only the dedicated connections carry the client name: pooled sessions
	// are shared by every backend of the process.
	clientName := ""
	if bo.WithBlockingConnection {
		clientName = b.ClientName(bo.ClientNameSuffix)
	}
	connConfig := func() *pgx.ConnConfig { return b.pool.Config().ConnConfig.Copy() }
	b.jobs = newListener(name, jobsChannel, "listen_jobs", clientName, connConfig)
	b.events = newListener(name, eventsChannel, "listen_events", clientName, connConfig)
	return b, nil
}

// Pool returns the query pool. A shared pool is closed after the last
// backend using it is closed.
func (b *Backend) Pool() *pgxpool.Pool { return b.pool }

// Schema returns the schema the queue lives in.
func (b *Backend) Schema() string { return b.schema }

// Close closes the dedicated connections and releases the backend's use of
// the query pool. A shared pool is closed once its last backend is closed and
// its running operations end; a caller-supplied pool is left untouched.
func (b *Backend) Close() error {
	b.closeOnce.Do(func() {
		b.meta.Stop()
		close(b.closing)
		b.jobs.close()
		b.events.close()
		if b.shared != nil {
			b.shared.release()
		}
	})
	return nil
}

func (b *Backend) isClosed() bool {
	select {
	case <-b.closing:
		return true
	default:
		return false
	}
}

// SetName sets the application_name of the dedicated connection used by
// WaitForJob, opening it when needed, so the worker is listed by worker
// discovery (Queue.Workers here, getWorkers in the other ports). Pooled
// connections are never named.
func (b *Backend) SetName(ctx context.Context, name string) error {
	return b.jobs.setName(ctx, name)
}

// IsTransientError reports whether err is a connectivity or server
// availability problem that is worth retrying.
func (b *Backend) IsTransientError(err error) bool { return isTransientError(err) }

// QueueName returns the bare queue name.
func (b *Backend) QueueName() string { return b.name }

// QualifiedName returns the queue name: the schema, not a key prefix,
// namespaces queues on PostgreSQL.
func (b *Backend) QualifiedName() string { return b.name }

// ResolveParent returns the parent reference and `{queue}:{id}` key stored
// for a job added under parent. A Redis style `{prefix}:{queue}` parent queue
// is accepted and stored as the bare queue name.
func (b *Backend) ResolveParent(parent *bullmq.ParentOptions) (*bullmq.ParentKeys, string, error) {
	queue := parent.Queue
	if i := strings.LastIndex(queue, ":"); i >= 0 {
		queue = queue[i+1:]
	}
	if queue == "" {
		return nil, "", configError("parent queue must be provided")
	}
	return &bullmq.ParentKeys{ID: parent.ID, QueueKey: queue}, queue + ":" + parent.ID, nil
}

// ClientName returns `{queue}{suffix}`, the application_name worker
// discovery looks for, as in the Node.js PostgreSQL backend.
func (b *Backend) ClientName(suffix string) string { return b.name + suffix }

// run executes a shared command on the pool, after making sure the schema is
// ready, and maps its errors.
func (b *Backend) run(ctx context.Context, cmd string, fn func(ctx context.Context, sql string) error) error {
	sql, err := command(cmd)
	if err != nil {
		return err
	}
	return b.runSQL(ctx, cmd, sql, fn)
}

// runSQL is run for any statement; label names it in errors.
func (b *Backend) runSQL(ctx context.Context, label, sql string, fn func(ctx context.Context, sql string) error) error {
	if b.isClosed() {
		return errClosed
	}
	if b.shared != nil {
		if !b.shared.begin() {
			return errClosed
		}
		defer b.shared.end()
	}
	if err := b.ensureReady(ctx); err != nil {
		return err
	}
	b.meta.Write(ctx, b.writeMeta, isTransientError)
	return mapError(label, fn(ctx, sql))
}

// exec runs a command whose result is not needed.
func (b *Backend) exec(ctx context.Context, cmd string, args ...any) error {
	return b.run(ctx, cmd, func(ctx context.Context, sql string) error {
		_, err := b.pool.Exec(ctx, sql, args...)
		return err
	})
}

// queryRow runs a command that returns a single row and scans it into dest.
// It returns pgx.ErrNoRows when there is no row.
func (b *Backend) queryRow(ctx context.Context, cmd string, args []any, dest ...any) error {
	return b.run(ctx, cmd, func(ctx context.Context, sql string) error {
		return b.pool.QueryRow(ctx, sql, args...).Scan(dest...)
	})
}

// queryStrings runs a command returning a single text column.
func (b *Backend) queryStrings(ctx context.Context, cmd string, args ...any) ([]string, error) {
	var out []string
	err := b.run(ctx, cmd, func(ctx context.Context, sql string) error {
		rows, err := b.pool.Query(ctx, sql, args...)
		if err != nil {
			return err
		}
		out, err = pgx.CollectRows(rows, pgx.RowTo[string])
		return err
	})
	if out == nil {
		out = []string{}
	}
	return out, err
}

// queryJobs runs a command returning job rows.
func (b *Backend) queryJobs(ctx context.Context, cmd string, args ...any) ([]*bullmq.JobRecord, error) {
	var out []*bullmq.JobRecord
	err := b.run(ctx, cmd, func(ctx context.Context, sql string) error {
		rows, err := b.pool.Query(ctx, sql, args...)
		if err != nil {
			return err
		}
		out, err = scanJobRows(rows)
		return err
	})
	return out, err
}

func nowMillis() int64 { return time.Now().UnixMilli() }

// sleepCtx waits for d, returning false when ctx is cancelled first.
func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

func configError(format string, args ...any) error {
	return &bullmq.ConfigError{Message: fmt.Sprintf(format, args...)}
}

// quoteIdent quotes a validated schema name.
func quoteIdent(name string) string { return `"` + name + `"` }
