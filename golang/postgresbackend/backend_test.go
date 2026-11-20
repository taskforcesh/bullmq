package postgresbackend

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// These tests need a PostgreSQL database: POSTGRES_URL. Each one works in a
// schema of its own, dropped when it ends.

func testURL(t *testing.T) string {
	t.Helper()
	url := os.Getenv("POSTGRES_URL")
	if url == "" {
		t.Skip("POSTGRES_URL is not set")
	}
	return url
}

var schemaSeq atomic.Int64

// newSchema returns the name of a schema unique to the test and drops it
// when the test ends.
func newSchema(t *testing.T) string {
	t.Helper()
	name := fmt.Sprintf("gotest_pg_%d_%d", time.Now().UnixNano()%1_000_000_000, schemaSeq.Add(1))
	t.Cleanup(func() {
		conn := adminConn(t)
		if _, err := conn.Exec(context.Background(), "DROP SCHEMA IF EXISTS "+quoteIdent(name)+" CASCADE"); err != nil {
			t.Errorf("dropping schema %s: %v", name, err)
		}
	})
	return name
}

// adminConn opens a connection outside any pool, closed when the test ends.
func adminConn(t *testing.T) *pgx.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, testURL(t))
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	return conn
}

func testCtx(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func newBackend(t *testing.T, opts Options, queue string, bo bullmq.BackendOptions) *Backend {
	t.Helper()
	b, err := NewBackend(queue, opts, bo)
	if err != nil {
		t.Fatalf("NewBackend: %v", err)
	}
	t.Cleanup(func() { _ = b.Close() })
	return b
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func ledger(t *testing.T, schema string) map[int]string {
	t.Helper()
	rows, err := adminConn(t).Query(testCtx(t),
		"SELECT version, name, min_client_version, applied_at < '2001-01-01' FROM "+quoteIdent(schema)+".migration ORDER BY version")
	if err != nil {
		t.Fatalf("reading the ledger: %v", err)
	}
	out := map[int]string{}
	var (
		version, minClient int
		name               string
		old                bool
	)
	_, err = pgx.ForEachRow(rows, []any{&version, &name, &minClient, &old}, func() error {
		out[version] = fmt.Sprintf("%s/%d/old=%v", name, minClient, old)
		return nil
	})
	if err != nil {
		t.Fatalf("reading the ledger: %v", err)
	}
	return out
}

func TestMigrationsApplyOnlyWhatANodeLedgerLacks(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)
	bundled, err := bundledMigrations()
	if err != nil {
		t.Fatal(err)
	}
	if len(bundled) < 3 {
		t.Fatalf("only %d bundled migrations", len(bundled))
	}
	applied := len(bundled) - 2

	// Bring the schema to an older version as the Node.js migrator does, with
	// an old applied_at so rewritten rows would show.
	conn := adminConn(t)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		"CREATE SCHEMA " + quoteIdent(schema),
		"SET LOCAL search_path TO " + quoteIdent(schema),
		`CREATE TABLE migration (version integer PRIMARY KEY, name text NOT NULL,
		   min_client_version integer NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
	} {
		if _, err := tx.Exec(ctx, stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	for _, m := range bundled[:applied] {
		if _, err := tx.Exec(ctx, m.sql); err != nil {
			t.Fatalf("applying %s: %v", m.name, err)
		}
		if _, err := tx.Exec(ctx,
			"INSERT INTO migration (version, name, min_client_version, applied_at) VALUES ($1, $2, 6, '2000-01-01')",
			m.version, m.name); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	b := newBackend(t, Options{ConnString: url, Schema: schema}, "ledger", bullmq.BackendOptions{})
	q, err := bullmq.NewQueue("ledger", &bullmq.QueueOptions{Backend: func(string, bullmq.BackendOptions) (bullmq.Backend, error) { return b, nil }})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := q.Add(ctx, "job", map[string]int{"n": 1}, nil); err != nil {
		t.Fatalf("Add on a migrated schema: %v", err)
	}

	got := ledger(t, schema)
	if len(got) != len(bundled) {
		t.Fatalf("ledger has %d rows, want %d: %v", len(got), len(bundled), got)
	}
	for i, m := range bundled {
		want := fmt.Sprintf("%s/6/old=%v", m.name, i < applied)
		if got[m.version] != want {
			t.Errorf("ledger row %d = %q, want %q", m.version, got[m.version], want)
		}
	}
}

func TestMigrationsRefuseASchemaForANewerClient(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)

	first := newBackend(t, Options{ConnString: url, Schema: schema}, "guard", bullmq.BackendOptions{})
	if _, err := first.GetCounts(ctx, []bullmq.JobState{bullmq.StateWaiting}); err != nil {
		t.Fatalf("GetCounts: %v", err)
	}
	if _, err := adminConn(t).Exec(ctx,
		"INSERT INTO "+quoteIdent(schema)+".migration (version, name, min_client_version) VALUES (9999, '9999_future', 7)"); err != nil {
		t.Fatal(err)
	}

	// The process already migrated the schema, but every new backend checks
	// the ledger again.
	second := newBackend(t, Options{ConnString: url, Schema: schema}, "guard", bullmq.BackendOptions{})
	_, err := second.GetCounts(ctx, []bullmq.JobState{bullmq.StateWaiting})
	var versionErr *SchemaVersionError
	if !errors.As(err, &versionErr) || versionErr.Required != 7 || versionErr.Supported != 6 {
		t.Fatalf("GetCounts on a schema requiring major 7: err = %v, want a SchemaVersionError", err)
	}
	if !strings.Contains(err.Error(), "requires BullMQ major version 7") {
		t.Fatalf("error %q does not explain the version requirement", err)
	}

	// A process that never saw the schema refuses it while migrating.
	forgetMigrations(url, schema)
	third := newBackend(t, Options{ConnString: url, Schema: schema}, "guard", bullmq.BackendOptions{})
	if _, err := third.GetCounts(ctx, nil); !errors.As(err, &versionErr) {
		t.Fatalf("migrating a schema requiring major 7: err = %v, want a SchemaVersionError", err)
	}
}

// forgetMigrations makes the process forget it migrated schema.
func forgetMigrations(url, schema string) {
	migrationStates.Delete(url + "\x00" + schema)
}

func TestMigrationsRunAgainWhenTheSchemaWasDropped(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)
	opts := Options{ConnString: url, Schema: schema}

	first := newBackend(t, opts, "dropped", bullmq.BackendOptions{})
	if _, err := first.AddJob(ctx, bullmq.NewJob{Name: "a", Data: []byte(`{}`), Opts: &bullmq.JobOptions{}}); err != nil {
		t.Fatalf("AddJob: %v", err)
	}
	if _, err := adminConn(t).Exec(ctx, "DROP SCHEMA "+quoteIdent(schema)+" CASCADE"); err != nil {
		t.Fatal(err)
	}

	second := newBackend(t, opts, "dropped", bullmq.BackendOptions{})
	id, err := second.AddJob(ctx, bullmq.NewJob{Name: "b", Data: []byte(`{}`), Opts: &bullmq.JobOptions{}})
	if err != nil {
		t.Fatalf("AddJob after the schema was dropped: %v", err)
	}
	if job, err := second.GetJob(ctx, id); err != nil || job == nil || job.Name != "b" {
		t.Fatalf("GetJob(%s) = %+v, %v", id, job, err)
	}
	if got := ledger(t, schema); len(got) == 0 {
		t.Fatal("the ledger was not recreated")
	}
}

func TestBackendsShareOnePoolPerConnectionSchemaAndSize(t *testing.T) {
	url := testURL(t)
	schema := newSchema(t)

	a := newBackend(t, Options{ConnString: url, Schema: schema}, "a", bullmq.BackendOptions{})
	b := newBackend(t, Options{ConnString: url, Schema: schema, PoolSize: DefaultPoolSize}, "b", bullmq.BackendOptions{})
	if a.Pool() != b.Pool() {
		t.Fatal("backends with the same settings use different pools")
	}
	if got := a.Pool().Config().MaxConns; got != DefaultPoolSize {
		t.Fatalf("default pool size = %d, want %d", got, DefaultPoolSize)
	}
	if sp := a.Pool().Config().ConnConfig.RuntimeParams["search_path"]; sp != quoteIdent(schema) {
		t.Fatalf("pooled search_path = %q, want %q", sp, quoteIdent(schema))
	}

	c := newBackend(t, Options{ConnString: url, Schema: schema, PoolSize: 3}, "c", bullmq.BackendOptions{})
	if c.Pool() == a.Pool() {
		t.Fatal("backends with different pool sizes share a pool")
	}
	if got := c.Pool().Config().MaxConns; got != 3 {
		t.Fatalf("pool size = %d, want 3", got)
	}
	other := newSchema(t)
	d := newBackend(t, Options{ConnString: url, Schema: other}, "d", bullmq.BackendOptions{})
	if d.Pool() == a.Pool() {
		t.Fatal("backends with different schemas share a pool")
	}

	if _, err := NewBackend("x", Options{ConnString: url, Schema: "bad-name"}, bullmq.BackendOptions{}); err == nil {
		t.Fatal("NewBackend accepted an invalid schema name")
	}
	if _, err := NewBackend("x", Options{}, bullmq.BackendOptions{}); err == nil {
		t.Fatal("NewBackend accepted options without a connection")
	}
}

func TestLastCloseClearsThePool(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)
	opts := Options{ConnString: url, Schema: schema, PoolSize: 4}

	a := newBackend(t, opts, "close-a", bullmq.BackendOptions{})
	b := newBackend(t, opts, "close-b", bullmq.BackendOptions{})
	for _, be := range []*Backend{a, b} {
		if _, err := be.GetCounts(ctx, nil); err != nil {
			t.Fatalf("GetCounts: %v", err)
		}
	}
	pool := a.Pool()
	if pool.Stat().TotalConns() == 0 {
		t.Fatal("the pool holds no connection after a query")
	}

	_ = a.Close()
	if pool.Stat().TotalConns() == 0 {
		t.Fatal("closing one of two backends cleared the shared pool")
	}
	if _, err := b.GetCounts(ctx, nil); err != nil {
		t.Fatalf("GetCounts on the open backend: %v", err)
	}
	if _, err := a.GetCounts(ctx, nil); !errors.Is(err, errClosed) {
		t.Fatalf("GetCounts on a closed backend: err = %v, want errClosed", err)
	}
	_ = b.Close()
	_ = b.Close()
	eventually(t, "the pool to close its connections", func() bool { return pool.Stat().TotalConns() == 0 })
}

// An operation waiting for a pool slot when the last backend closes opens a
// connection after the close cleared the pool. It must not stay idle in the
// pool.
func TestAnOperationFinishingAfterTheLastCloseLeavesNoConnection(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)

	b := newBackend(t, Options{ConnString: url, Schema: schema, PoolSize: 1}, "late", bullmq.BackendOptions{})
	if _, err := b.GetCounts(ctx, nil); err != nil {
		t.Fatalf("GetCounts: %v", err)
	}
	pool := b.Pool()
	held, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() {
		_, err := b.GetCounts(ctx, nil)
		done <- err
	}()
	// Let the operation block waiting for the held connection.
	time.Sleep(200 * time.Millisecond)
	_ = b.Close()
	held.Release()
	if err := <-done; err != nil {
		t.Fatalf("GetCounts that waited for a connection: %v", err)
	}
	time.Sleep(100 * time.Millisecond)
	if n := pool.Stat().TotalConns(); n != 0 {
		t.Fatalf("the pool holds %d connections after the last close", n)
	}
}

func TestDedicatedConnectionsDoNotTakePoolSlots(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)
	opts := Options{ConnString: url, Schema: schema, PoolSize: 1}
	queue := "slots"

	worker := newBackend(t, opts, queue, bullmq.BackendOptions{WithBlockingConnection: true, ClientNameSuffix: ":w:one"})
	events := newBackend(t, opts, queue, bullmq.BackendOptions{WithBlockingConnection: true, ClientNameSuffix: ":qe"})
	producer := newBackend(t, opts, queue, bullmq.BackendOptions{})
	if err := worker.SetName(ctx, worker.ClientName(":w:one")); err != nil {
		t.Fatalf("SetName: %v", err)
	}

	woken := make(chan bullmq.WaitResult, 1)
	go func() {
		res, _ := worker.WaitForJob(ctx, 20*time.Second)
		woken <- res
	}()
	read := make(chan []bullmq.QueueEvent, 1)
	go func() {
		evs, _ := events.ReadEvents(ctx, "0-0", 20*time.Second)
		read <- evs
	}()
	eventually(t, "both LISTEN connections", func() bool { return worker.jobs.isRunning() && events.events.isRunning() })
	// Let both waits block on their notifications.
	time.Sleep(200 * time.Millisecond)

	start := time.Now()
	id, err := producer.AddJob(ctx, bullmq.NewJob{Name: "n", Data: []byte(`1`), Opts: &bullmq.JobOptions{}})
	if err != nil {
		t.Fatalf("AddJob with both LISTEN connections open: %v", err)
	}
	select {
	case res := <-woken:
		if !res.Woken {
			t.Fatalf("WaitForJob = %+v, want woken", res)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("WaitForJob was not woken by the added job")
	}
	select {
	case evs := <-read:
		if len(evs) == 0 || evs[0].JobID != id {
			t.Fatalf("ReadEvents = %+v, want the events of job %s", evs, id)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ReadEvents was not woken by the added job")
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("waking up took %v", elapsed)
	}
	if n := producer.Pool().Stat().TotalConns(); n > 1 {
		t.Fatalf("the pool of size 1 holds %d connections", n)
	}
}

func TestDiscoveryNamesOnlyTheDedicatedConnections(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)
	factory := New(Options{ConnString: url, Schema: schema})
	queue := fmt.Sprintf("discovery-%d", time.Now().UnixNano())

	q, err := bullmq.NewQueue(queue, &bullmq.QueueOptions{Backend: factory})
	if err != nil {
		t.Fatal(err)
	}
	defer q.Close()
	if _, err := q.Add(ctx, "job", nil, nil); err != nil {
		t.Fatalf("Add: %v", err)
	}

	runWorker := func(name string) *bullmq.Worker {
		w, err := bullmq.NewWorker(queue, func(context.Context, *bullmq.Job) (any, error) { return nil, nil },
			&bullmq.WorkerOptions{Backend: factory, Name: name, DrainDelay: 200 * time.Millisecond, SkipStalledCheck: true})
		if err != nil {
			t.Fatal(err)
		}
		runCtx, cancel := context.WithCancel(context.Background())
		stopped := make(chan struct{})
		go func() {
			defer close(stopped)
			_ = w.Run(runCtx)
		}()
		t.Cleanup(func() {
			cancel()
			<-stopped
			_ = w.Close()
		})
		return w
	}
	runWorker("")
	runWorker("named")

	want := []string{queue, queue + ":w:named"}
	eventually(t, "both workers to be discovered", func() bool {
		names, err := q.Workers(ctx)
		return err == nil && len(names) == 2
	})
	names, _ := q.Workers(ctx)
	if !(names[0] == want[0] && names[1] == want[1]) && !(names[0] == want[1] && names[1] == want[0]) {
		t.Fatalf("Workers = %v, want %v", names, want)
	}

	qe, err := bullmq.NewQueueEvents(queue, &bullmq.QueueEventsOptions{Backend: factory, BlockingTimeout: 200 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	qeCtx, cancelQE := context.WithCancel(context.Background())
	qeDone := make(chan struct{})
	go func() {
		defer close(qeDone)
		_ = qe.Run(qeCtx)
	}()
	defer func() {
		cancelQE()
		<-qeDone
		_ = qe.Close()
	}()

	countNamed := func(name string) int {
		var n int
		if err := adminConn(t).QueryRow(ctx,
			"SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND application_name = $1",
			name).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	eventually(t, "the queue events connection to be named", func() bool { return countNamed(queue+":qe") == 1 })
	// The queue, both workers and the listener issued pooled queries, yet only
	// each worker's dedicated connection carries its name.
	if n := countNamed(queue); n != 1 {
		t.Fatalf("%d sessions are named %q, want only the unnamed worker's", n, queue)
	}
	if names, err := q.Workers(ctx); err != nil || len(names) != 2 {
		t.Fatalf("Workers with queue events running = %v, %v; want 2 workers", names, err)
	}
}

func TestCloseInterruptsTheBlockingWaits(t *testing.T) {
	url := testURL(t)
	schema := newSchema(t)
	b := newBackend(t, Options{ConnString: url, Schema: schema}, "interrupt", bullmq.BackendOptions{WithBlockingConnection: true})
	ctx := context.Background()

	waited := make(chan error, 2)
	go func() {
		_, err := b.WaitForJob(ctx, time.Minute)
		waited <- err
	}()
	go func() {
		_, err := b.ReadEvents(ctx, "0-0", time.Minute)
		waited <- err
	}()
	eventually(t, "both LISTEN connections", func() bool { return b.jobs.isRunning() && b.events.isRunning() })
	time.Sleep(100 * time.Millisecond)

	start := time.Now()
	_ = b.Close()
	for range 2 {
		select {
		case err := <-waited:
			if err != nil {
				t.Fatalf("blocking wait ended with %v", err)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("Close did not interrupt a blocking wait")
		}
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("interrupting the waits took %v", elapsed)
	}
	if b.jobs.isRunning() || b.events.isRunning() {
		t.Fatal("a LISTEN connection is still open after Close")
	}
	if _, err := b.WaitForJob(ctx, time.Second); !errors.Is(err, errClosed) {
		t.Fatalf("WaitForJob after Close: err = %v, want errClosed", err)
	}
}

func TestWaitForJobWakesWhenAJobIsAdded(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)
	opts := Options{ConnString: url, Schema: schema}
	b := newBackend(t, opts, "wake", bullmq.BackendOptions{WithBlockingConnection: true})
	other := newBackend(t, opts, "wake-other", bullmq.BackendOptions{})
	producer := newBackend(t, opts, "wake", bullmq.BackendOptions{})

	res := make(chan bullmq.WaitResult, 1)
	go func() {
		r, _ := b.WaitForJob(ctx, 20*time.Second)
		res <- r
	}()
	eventually(t, "the LISTEN connection", b.jobs.isRunning)
	time.Sleep(100 * time.Millisecond)

	// A job of another queue on the shared channel does not wake it.
	if _, err := other.AddJob(ctx, bullmq.NewJob{Name: "x", Data: []byte(`{}`), Opts: &bullmq.JobOptions{}}); err != nil {
		t.Fatal(err)
	}
	select {
	case r := <-res:
		t.Fatalf("WaitForJob woke up for another queue: %+v", r)
	case <-time.After(300 * time.Millisecond):
	}

	if _, err := producer.AddJob(ctx, bullmq.NewJob{Name: "y", Data: []byte(`{}`), Opts: &bullmq.JobOptions{}}); err != nil {
		t.Fatal(err)
	}
	select {
	case r := <-res:
		if !r.Woken {
			t.Fatalf("WaitForJob = %+v, want woken", r)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("WaitForJob was not woken by the added job")
	}
}

func TestACountOfZeroRemovesOnlyTheFinishedJob(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)
	b := newBackend(t, Options{ConnString: url, Schema: schema}, "keep", bullmq.BackendOptions{})

	finish := func(keep *bullmq.RemoveOnFinish) string {
		t.Helper()
		id, err := b.AddJob(ctx, bullmq.NewJob{Name: "j", Data: []byte(`{}`), Opts: &bullmq.JobOptions{}})
		if err != nil {
			t.Fatal(err)
		}
		res, err := b.MoveToActive(ctx, bullmq.MoveToActiveOptions{Token: "tok", LockDuration: time.Minute})
		if err != nil || res.Job == nil || res.Job.ID != id {
			t.Fatalf("MoveToActive = %+v, %v; want job %s", res, err, id)
		}
		if _, err := b.MoveToCompleted(ctx, id, []byte(`"ok"`), bullmq.FinishOptions{Token: "tok", KeepJobs: keep}); err != nil {
			t.Fatalf("MoveToCompleted: %v", err)
		}
		return id
	}
	kept := finish(nil)
	removed := finish(bullmq.KeepCount(0))

	if job, err := b.GetJob(ctx, removed); err != nil || job != nil {
		t.Fatalf("job finished with a keep count of 0 = %+v, %v; want removed", job, err)
	}
	if job, err := b.GetJob(ctx, kept); err != nil || job == nil {
		t.Fatalf("job finished earlier without a removal policy = %v, %v; want kept", job, err)
	}
}

func TestFinishingReportsTheSharedErrorCodes(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)
	b := newBackend(t, Options{ConnString: url, Schema: schema}, "codes", bullmq.BackendOptions{})

	if _, err := b.MoveToCompleted(ctx, "missing", nil, bullmq.FinishOptions{Token: "t"}); !errors.Is(err, bullmq.ErrJobNotFound) {
		t.Fatalf("MoveToCompleted on a missing job: err = %v, want ErrJobNotFound", err)
	}
	id, err := b.AddJob(ctx, bullmq.NewJob{Name: "j", Data: []byte(`{}`), Opts: &bullmq.JobOptions{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := b.MoveToFailed(ctx, id, bullmq.FailureInfo{Reason: "x"}, bullmq.FinishOptions{Token: "t"}); !errors.Is(err, bullmq.ErrJobNotInState) {
		t.Fatalf("MoveToFailed on a waiting job: err = %v, want ErrJobNotInState", err)
	}
	if _, err := b.MoveToActive(ctx, bullmq.MoveToActiveOptions{Token: "mine"}); err != nil {
		t.Fatal(err)
	}
	if _, err := b.MoveToCompleted(ctx, id, nil, bullmq.FinishOptions{Token: "theirs"}); !errors.Is(err, bullmq.ErrJobLockMismatch) {
		t.Fatalf("MoveToCompleted with another token: err = %v, want ErrJobLockMismatch", err)
	}
	if _, err := b.AddJob(ctx, bullmq.NewJob{Name: "c", Data: []byte(`{}`), Opts: &bullmq.JobOptions{
		Parent: &bullmq.ParentOptions{ID: "nope", Queue: "codes"},
	}}); !errors.Is(err, bullmq.ErrParentJobNotExist) {
		t.Fatalf("AddJob under a missing parent: err = %v, want ErrParentJobNotExist", err)
	}
}

func TestEventIDs(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)
	b := newBackend(t, Options{ConnString: url, Schema: schema}, "events", bullmq.BackendOptions{WithBlockingConnection: true})

	if id, err := b.LastEventID(ctx); err != nil || id != "0-0" {
		t.Fatalf("LastEventID on an empty stream = %q, %v; want 0-0", id, err)
	}
	if _, err := b.AddJob(ctx, bullmq.NewJob{Name: "j", Data: []byte(`{}`), Opts: &bullmq.JobOptions{}}); err != nil {
		t.Fatal(err)
	}
	evs, err := b.ReadEvents(ctx, "0-0", time.Second)
	if err != nil || len(evs) < 2 {
		t.Fatalf("ReadEvents(0-0) = %+v, %v; want the added and waiting events", evs, err)
	}
	if evs[0].Event != "added" || evs[0].Data["name"] != "j" || evs[0].Data["event"] != "added" {
		t.Fatalf("first event = %+v, want added", evs[0])
	}
	last, err := b.LastEventID(ctx)
	if err != nil || last != evs[len(evs)-1].ID {
		t.Fatalf("LastEventID = %q, %v; want %q", last, err, evs[len(evs)-1].ID)
	}
	if evs, err := b.ReadEvents(ctx, last, 50*time.Millisecond); err != nil || len(evs) != 0 {
		t.Fatalf("ReadEvents(last) = %+v, %v; want none", evs, err)
	}
	if _, err := b.ReadEvents(ctx, "not-an-id", time.Millisecond); err == nil {
		t.Fatal("ReadEvents accepted an invalid id")
	}
}

func TestACallerSuppliedPool(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)

	newPool := func(searchPath string) *pgxpool.Pool {
		cfg, err := pgxpool.ParseConfig(url)
		if err != nil {
			t.Fatal(err)
		}
		if searchPath != "" {
			cfg.ConnConfig.RuntimeParams["search_path"] = searchPath
		}
		pool, err := pgxpool.NewWithConfig(ctx, cfg)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(pool.Close)
		return pool
	}

	pool := newPool(schema)
	b := newBackend(t, Options{Pool: pool, Schema: schema}, "caller", bullmq.BackendOptions{})
	if _, err := b.AddJob(ctx, bullmq.NewJob{Name: "j", Data: []byte(`{}`), Opts: &bullmq.JobOptions{}}); err != nil {
		t.Fatalf("AddJob on a caller-supplied pool: %v", err)
	}
	_ = b.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("Close closed the caller's pool: %v", err)
	}

	wrong := newBackend(t, Options{Pool: newPool(""), Schema: schema}, "caller", bullmq.BackendOptions{})
	_, err := wrong.AddJob(ctx, bullmq.NewJob{Name: "j", Data: []byte(`{}`), Opts: &bullmq.JobOptions{}})
	var cfgErr *bullmq.ConfigError
	if !errors.As(err, &cfgErr) || !strings.Contains(err.Error(), "search_path") {
		t.Fatalf("AddJob on a pool without the schema's search_path: err = %v, want a ConfigError about search_path", err)
	}
}

func addTestJob(t *testing.T, ctx context.Context, b *Backend, delay int64) string {
	t.Helper()
	id, err := b.AddJob(ctx, bullmq.NewJob{Name: "j", Data: []byte(`{}`), Opts: &bullmq.JobOptions{Delay: bullmq.Int64(delay)}})
	if err != nil {
		t.Fatalf("AddJob: %v", err)
	}
	return id
}

// waitAsync runs WaitForJob in the background once the LISTEN connection is
// up, and returns its outcome and how long it took.
func waitAsync(t *testing.T, ctx context.Context, b *Backend, timeout time.Duration) <-chan [2]any {
	t.Helper()
	if err := b.jobs.ensure(ctx); err != nil {
		t.Fatal(err)
	}
	out := make(chan [2]any, 1)
	start := time.Now()
	go func() {
		res, err := b.WaitForJob(ctx, timeout)
		if err != nil {
			t.Errorf("WaitForJob: %v", err)
		}
		out <- [2]any{res, time.Since(start)}
	}()
	return out
}

func TestWaitForJobReportsNothingWhileTheQueueIsHeld(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)
	opts := Options{ConnString: url, Schema: schema}
	worker := newBackend(t, opts, "held", bullmq.BackendOptions{WithBlockingConnection: true})
	producer := newBackend(t, opts, "held", bullmq.BackendOptions{})

	// Paused: neither a waiting job, nor a delayed job coming due, nor the
	// notifications of the adds end the wait.
	if err := producer.Pause(ctx, true); err != nil {
		t.Fatal(err)
	}
	waited := waitAsync(t, ctx, worker, 800*time.Millisecond)
	time.Sleep(100 * time.Millisecond)
	addTestJob(t, ctx, producer, 0)
	addTestJob(t, ctx, producer, 200)
	got := <-waited
	if res, elapsed := got[0].(bullmq.WaitResult), got[1].(time.Duration); res.Woken || elapsed < 700*time.Millisecond {
		t.Fatalf("WaitForJob on a paused queue = %+v after %v, want a timeout", res, elapsed)
	}

	// Resuming wakes it.
	waited = waitAsync(t, ctx, worker, 10*time.Second)
	time.Sleep(100 * time.Millisecond)
	if err := producer.Pause(ctx, false); err != nil {
		t.Fatal(err)
	}
	got = <-waited
	if res, elapsed := got[0].(bullmq.WaitResult), got[1].(time.Duration); !res.Woken || elapsed > 3*time.Second {
		t.Fatalf("WaitForJob when the queue is resumed = %+v after %v, want woken", res, elapsed)
	}

	// At the global concurrency limit, a waiting job is not reported.
	if err := producer.SetQueueMeta(ctx, map[string]any{"concurrency": 1}); err != nil {
		t.Fatal(err)
	}
	if res, err := producer.MoveToActive(ctx, bullmq.MoveToActiveOptions{Token: "t", LockDuration: time.Minute}); err != nil || res.Job == nil {
		t.Fatalf("MoveToActive = %+v, %v", res, err)
	}
	waited = waitAsync(t, ctx, worker, 500*time.Millisecond)
	got = <-waited
	if res := got[0].(bullmq.WaitResult); res.Woken {
		t.Fatalf("WaitForJob on a maxed queue = %+v, want a timeout", res)
	}
}

func TestWaitForJobReportsADelayedJobAddedWhileWaiting(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)
	opts := Options{ConnString: url, Schema: schema}
	worker := newBackend(t, opts, "delayed", bullmq.BackendOptions{WithBlockingConnection: true})
	producer := newBackend(t, opts, "delayed", bullmq.BackendOptions{})

	waited := waitAsync(t, ctx, worker, 10*time.Second)
	time.Sleep(100 * time.Millisecond)
	id := addTestJob(t, ctx, producer, 600)
	job, err := producer.GetJob(ctx, id)
	if err != nil || job == nil {
		t.Fatalf("GetJob = %v, %v", job, err)
	}
	due := job.Timestamp + 600
	got := <-waited
	if res, elapsed := got[0].(bullmq.WaitResult), got[1].(time.Duration); !res.Woken || res.NextDelayedAt != due || elapsed > 400*time.Millisecond {
		t.Fatalf("WaitForJob after a delayed job was added = %+v after %v, want woken at once with NextDelayedAt %d", res, elapsed, due)
	}

	// The due time was reported: the next wait lasts until it.
	waited = waitAsync(t, ctx, worker, 10*time.Second)
	got = <-waited
	res, elapsed := got[0].(bullmq.WaitResult), got[1].(time.Duration)
	if !res.Woken || res.NextDelayedAt != 0 {
		t.Fatalf("WaitForJob until the delayed job is due = %+v, want woken", res)
	}
	if now := time.Now().UnixMilli(); now < due-50 || elapsed > 2*time.Second {
		t.Fatalf("WaitForJob returned %dms before the due time, after %v", due-now, elapsed)
	}
}

// breakFunction renames a function of the schema so the commands calling it
// fail from now on.
func breakFunction(t *testing.T, ctx context.Context, schema, signature, name string) {
	t.Helper()
	if _, err := adminConn(t).Exec(ctx,
		"ALTER FUNCTION "+quoteIdent(schema)+"."+signature+" RENAME TO "+name); err != nil {
		t.Fatal(err)
	}
}

// A finish whose fetch-next found nothing has committed when it asks why;
// failing to read the answer must not turn the finish into an error, which
// the worker would retry against a job that is no longer active.
func TestAFinishSucceedsWhenTheHintsOfAnEmptyFetchCannotBeRead(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)
	b := newBackend(t, Options{ConnString: url, Schema: schema}, "hints", bullmq.BackendOptions{})

	completed := addTestJob(t, ctx, b, 0)
	failed := addTestJob(t, ctx, b, 0)
	for _, id := range []string{completed, failed} {
		if res, err := b.MoveToActive(ctx, bullmq.MoveToActiveOptions{Token: "tok-" + id, LockDuration: time.Minute}); err != nil || res.Job == nil || res.Job.ID != id {
			t.Fatalf("MoveToActive = %+v, %v; want job %s", res, err, id)
		}
	}
	breakFunction(t, ctx, schema, "next_signal(text, integer, bigint)", "next_signal_gone")

	for _, tc := range []struct {
		id     string
		finish func(opts bullmq.FinishOptions) (*bullmq.FinishResult, error)
		state  bullmq.JobState
	}{
		{completed, func(opts bullmq.FinishOptions) (*bullmq.FinishResult, error) {
			return b.MoveToCompleted(ctx, completed, []byte(`1`), opts)
		}, bullmq.StateCompleted},
		{failed, func(opts bullmq.FinishOptions) (*bullmq.FinishResult, error) {
			return b.MoveToFailed(ctx, failed, bullmq.FailureInfo{Reason: "boom"}, opts)
		}, bullmq.StateFailed},
	} {
		res, err := tc.finish(bullmq.FinishOptions{Token: "tok-" + tc.id, LockDuration: time.Minute, FetchNext: true})
		if err != nil {
			t.Fatalf("finishing job %s: %v", tc.id, err)
		}
		if res.Next == nil || res.Next.Job != nil || res.Next.RateLimitDelay != 0 || res.Next.NextDelayedAt != 0 {
			t.Fatalf("finishing job %s fetched %+v, want an empty result without hints", tc.id, res.Next)
		}
		if state, err := b.GetState(ctx, tc.id); err != nil || state != tc.state {
			t.Fatalf("job %s is %q (%v), want %q", tc.id, state, err, tc.state)
		}
	}
}

// Likewise, once a job is delayed, failing to fetch the next one only means
// "fetch again".
func TestMoveToDelayedSucceedsWhenTheNextFetchFails(t *testing.T) {
	url := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)
	b := newBackend(t, Options{ConnString: url, Schema: schema}, "delay-fetch", bullmq.BackendOptions{})

	id := addTestJob(t, ctx, b, 0)
	if res, err := b.MoveToActive(ctx, bullmq.MoveToActiveOptions{Token: "tok", LockDuration: time.Minute}); err != nil || res.Job == nil {
		t.Fatalf("MoveToActive = %+v, %v", res, err)
	}
	breakFunction(t, ctx, schema, "move_to_active(text, text, bigint, bigint, text, integer, bigint)", "move_to_active_gone")

	next, err := b.MoveToDelayed(ctx, id, "tok", time.Minute, bullmq.MoveToDelayedOptions{FetchNext: true, LockDuration: time.Minute})
	if err != nil {
		t.Fatalf("MoveToDelayed: %v", err)
	}
	if next == nil || next.Job != nil {
		t.Fatalf("MoveToDelayed fetched %+v, want an empty result", next)
	}
	if state, err := b.GetState(ctx, id); err != nil || state != bullmq.StateDelayed {
		t.Fatalf("job is %q (%v), want delayed", state, err)
	}
}
