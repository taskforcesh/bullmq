package postgresbackend

import (
	"context"
	"fmt"
	"strconv"
	"sync"

	"github.com/jackc/pgx/v5"
	bullmq "github.com/taskforcesh/bullmq-go"
)

const (
	// migrationLockKey is the first key of the transaction-scoped advisory
	// lock that serializes migrations across processes and runtimes. It
	// spells `BULL`; every runtime uses the same key, with hashtext(schema)
	// as the second one.
	migrationLockKey int32 = 0x42554C4C
	// bullmqMajorVersion is the BullMQ major version of the shared schema
	// this package implements (the Node.js BULLMQ_MAJOR_VERSION, not this
	// module's version). It is recorded as min_client_version for every
	// migration applied here, and a schema requiring a newer major is refused.
	bullmqMajorVersion = 6
	// minimumServerMajor is the oldest supported PostgreSQL major version.
	minimumServerMajor = 13
	// legacyLedgerTable is the ledger of .NET releases that predate the
	// shared one. Its rows are adopted so those schemas are not migrated
	// again.
	legacyLedgerTable = "bullmq_migration"
)

// SchemaVersionError is returned when the migration ledger of the schema
// requires a newer BullMQ major version than this package implements, for
// example after another runtime applied a breaking migration.
type SchemaVersionError struct {
	Schema string
	// Required is the highest min_client_version recorded in the ledger.
	Required int
	// Supported is the BullMQ major version this package implements.
	Supported int
}

func (e *SchemaVersionError) Error() string {
	return fmt.Sprintf("bullmq: PostgreSQL schema %q requires BullMQ major version %d or newer, but this client implements major version %d; upgrade the client to use this schema",
		e.Schema, e.Required, e.Supported)
}

// migrationState records whether this process migrated a schema of a
// database.
type migrationState struct {
	mu   sync.Mutex
	done bool
}

var migrationStates sync.Map

// ensureReady prepares the schema before the backend's first operation.
func (b *Backend) ensureReady(ctx context.Context) error {
	if b.ready.Load() {
		return nil
	}
	b.readyMu.Lock()
	defer b.readyMu.Unlock()
	if b.ready.Load() {
		return nil
	}
	if err := b.prepareSchema(ctx); err != nil {
		return err
	}
	var version string
	if err := b.pool.QueryRow(ctx, "SELECT current_setting('server_version_num')").Scan(&version); err != nil {
		return err
	}
	b.serverMajor, _ = strconv.Atoi(version)
	b.serverMajor /= 10000
	b.ready.Store(true)
	return nil
}

// prepareSchema migrates the schema once per process and database, and
// checks it for every new backend: another runtime may have changed it
// since, requiring a newer client or dropping it altogether (it is migrated
// again then).
func (b *Backend) prepareSchema(ctx context.Context) error {
	v, _ := migrationStates.LoadOrStore(b.migrateKey, &migrationState{})
	st := v.(*migrationState)
	st.mu.Lock()
	defer st.mu.Unlock()

	remigrate := false
	if st.done {
		err := b.checkCompatible(ctx)
		switch {
		case err == nil:
		case isUndefinedTable(err):
			st.done = false
			remigrate = true
		default:
			return err
		}
	}
	if !st.done {
		if err := b.migrate(ctx); err != nil {
			return err
		}
		st.done = true
		if remigrate && b.shared != nil {
			// Pooled sessions may hold statements prepared against the objects
			// of the schema that was dropped.
			b.pool.Reset()
		}
	}
	if b.shared == nil {
		return b.checkSearchPath(ctx)
	}
	return nil
}

// checkCompatible reads the highest min_client_version of the ledger.
func (b *Backend) checkCompatible(ctx context.Context) error {
	var required int
	err := b.pool.QueryRow(ctx,
		"SELECT COALESCE(MAX(min_client_version), $1)::int FROM "+quoteIdent(b.schema)+".migration",
		bullmqMajorVersion).Scan(&required)
	if err != nil {
		return err
	}
	if required > bullmqMajorVersion {
		return &SchemaVersionError{Schema: b.schema, Required: required, Supported: bullmqMajorVersion}
	}
	return nil
}

// checkSearchPath verifies that a caller-supplied pool resolves names in the
// schema.
func (b *Backend) checkSearchPath(ctx context.Context) error {
	var current *string
	if err := b.pool.QueryRow(ctx, "SELECT current_schema()").Scan(&current); err != nil {
		return err
	}
	if current == nil || *current != b.schema {
		got := "none"
		if current != nil {
			got = strconv.Quote(*current)
		}
		return configError("the caller-supplied PostgreSQL pool must use the schema %q as its search_path (its current schema is %s), for example with config.ConnConfig.RuntimeParams[\"search_path\"]", b.schema, got)
	}
	return nil
}

// Migrate brings the schema of opts up to date, as the backends do on first
// use unless Options.SkipMigrations is set. Run it as a deployment step,
// with a role that may create the schema and own its objects, so that the
// application can use a role with less privilege and SkipMigrations.
func Migrate(ctx context.Context, opts Options) error {
	opts.SkipMigrations = false
	b, err := NewBackend("migrate", opts, bullmq.BackendOptions{})
	if err != nil {
		return err
	}
	defer b.Close()
	return b.ensureReady(ctx)
}

// migrate brings the schema up to the latest bundled migration, as the other
// runtimes do: in one transaction, so the migrations and their ledger rows
// commit together or not at all, serialized per schema by an advisory lock,
// and recorded in the shared `migration` ledger. It first reads the ledger,
// and runs no DDL when it is up to date, so a role that does not own the
// schema can start.
func (b *Backend) migrate(ctx context.Context) error {
	bundled, err := bundledMigrations()
	if err != nil {
		return err
	}
	if !b.skipVersionCheck {
		var num string
		if err := b.pool.QueryRow(ctx, "SELECT current_setting('server_version_num')").Scan(&num); err != nil {
			return err
		}
		n, _ := strconv.Atoi(num)
		if major := n / 10000; major < minimumServerMajor {
			return configError("the PostgreSQL backend requires server version %d or newer, but the server reports major version %d; set SkipVersionCheck to bypass this check at your own risk",
				minimumServerMajor, major)
		}
	}
	latest := 0
	if len(bundled) > 0 {
		latest = bundled[len(bundled)-1].version
	}
	upToDate, err := b.ledgerUpToDate(ctx, latest)
	if err != nil || upToDate {
		return err
	}
	if b.skipMigrations {
		return configError("the PostgreSQL schema %q is not migrated to version %d, and SkipMigrations is set: run postgresbackend.Migrate first", b.schema, latest)
	}

	conn, err := b.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()

	quoted := quoteIdent(b.schema)
	if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1, hashtext($2))", migrationLockKey, b.schema); err != nil {
		return err
	}
	for _, stmt := range []string{
		"CREATE SCHEMA IF NOT EXISTS " + quoted,
		"SET LOCAL search_path TO " + quoted,
	} {
		if _, err := tx.Exec(ctx, stmt); err != nil {
			return err
		}
	}
	if err := ensureLedger(ctx, tx); err != nil {
		return err
	}
	hasLegacy, err := adoptLegacyLedger(ctx, tx, quoted)
	if err != nil {
		return err
	}

	var current, required int
	if err := tx.QueryRow(ctx, "SELECT COALESCE(MAX(version), 0)::int FROM migration").Scan(&current); err != nil {
		return err
	}
	if err := tx.QueryRow(ctx, "SELECT COALESCE(MAX(min_client_version), $1)::int FROM migration", bullmqMajorVersion).Scan(&required); err != nil {
		return err
	}
	if required > bullmqMajorVersion {
		return &SchemaVersionError{Schema: b.schema, Required: required, Supported: bullmqMajorVersion}
	}

	for _, m := range bundled {
		if m.version <= current {
			continue
		}
		if _, err := tx.Exec(ctx, m.sql); err != nil {
			return fmt.Errorf("bullmq: PostgreSQL migration %s failed: %w", m.name, err)
		}
		if _, err := tx.Exec(ctx,
			"INSERT INTO migration (version, name, min_client_version) VALUES ($1, $2, $3)",
			m.version, m.name, bullmqMajorVersion); err != nil {
			return err
		}
	}

	if hasLegacy {
		// Older .NET instances still read the legacy ledger; record there
		// every migration it lacks so they don't apply them again.
		if _, err := tx.Exec(ctx,
			"INSERT INTO "+legacyLedgerTable+" (version, name, applied_at) "+
				"SELECT version, name, applied_at FROM migration ON CONFLICT (version) DO NOTHING"); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ledgerUpToDate reads the ledger, without DDL, and reports whether it
// records every migration up to latest, with no ledger upgrade pending. It
// returns a SchemaVersionError when the schema requires a newer client, and
// false when the schema or the ledger does not exist yet.
func (b *Backend) ledgerUpToDate(ctx context.Context, latest int) (bool, error) {
	var current, required int
	var pending bool
	err := b.pool.QueryRow(ctx,
		"SELECT COALESCE(MAX(version), 0)::int, COALESCE(MAX(min_client_version), $1)::int, "+
			"COALESCE(bool_or(min_client_version IS NULL), false) FROM "+quoteIdent(b.schema)+".migration",
		bullmqMajorVersion).Scan(&current, &required, &pending)
	if isUndefinedTable(err) || isUndefinedColumn(err) || isUndefinedSchema(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if required > bullmqMajorVersion {
		return false, &SchemaVersionError{Schema: b.schema, Required: required, Supported: bullmqMajorVersion}
	}
	return current >= latest && !pending, nil
}

// ensureLedger creates the shared ledger with the same DDL as the other
// runtimes, including their upgrade of a ledger created before
// min_client_version existed.
func ensureLedger(ctx context.Context, tx pgx.Tx) error {
	for _, stmt := range []string{
		"CREATE TABLE IF NOT EXISTS migration (" +
			"version integer PRIMARY KEY, name text NOT NULL, " +
			"min_client_version integer NOT NULL, " +
			"applied_at timestamptz NOT NULL DEFAULT now())",
		"ALTER TABLE migration ADD COLUMN IF NOT EXISTS min_client_version integer",
	} {
		if _, err := tx.Exec(ctx, stmt); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(ctx,
		"UPDATE migration SET min_client_version = $1 WHERE min_client_version IS NULL",
		bullmqMajorVersion); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, "ALTER TABLE migration ALTER COLUMN min_client_version SET NOT NULL")
	return err
}

// adoptLegacyLedger copies the rows of a legacy .NET ledger into the shared
// one and reports whether it exists. The legacy table is never dropped.
func adoptLegacyLedger(ctx context.Context, tx pgx.Tx, quotedSchema string) (bool, error) {
	var exists bool
	if err := tx.QueryRow(ctx, "SELECT to_regclass($1) IS NOT NULL",
		quotedSchema+"."+legacyLedgerTable).Scan(&exists); err != nil {
		return false, err
	}
	if !exists {
		return false, nil
	}
	_, err := tx.Exec(ctx,
		"INSERT INTO migration (version, name, min_client_version, applied_at) "+
			"SELECT version, name, $1, applied_at FROM "+legacyLedgerTable+" "+
			"ON CONFLICT (version) DO NOTHING",
		bullmqMajorVersion)
	return true, err
}
