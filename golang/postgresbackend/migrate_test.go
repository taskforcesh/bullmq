package postgresbackend

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// newAppRole creates a login role that may use the objects of schema (DML,
// and CREATE in the schema, where the shared SQL creates a job id sequence
// per queue) but owns none of them nor may create schemas, and returns the
// test URL rewritten to connect as it. The role is dropped when the test
// ends.
func newAppRole(t *testing.T, ctx context.Context, schema string) string {
	t.Helper()
	u, err := url.Parse(testURL(t))
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") {
		t.Skip("POSTGRES_URL is not a postgres:// URL")
	}
	admin := adminConn(t)
	role := fmt.Sprintf("gotest_app_%d", time.Now().UnixNano()%1_000_000_000)
	const password = "gotest-app-password"
	if _, err := admin.Exec(ctx, "CREATE ROLE "+quoteIdent(role)+" LOGIN PASSWORD '"+password+"'"); err != nil {
		t.Skipf("cannot create a role: %v", err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = admin.Exec(ctx, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = $1", role)
		if _, err := admin.Exec(ctx, "DROP OWNED BY "+quoteIdent(role)); err != nil {
			t.Errorf("DROP OWNED BY %s: %v", role, err)
		}
		if _, err := admin.Exec(ctx, "DROP ROLE "+quoteIdent(role)); err != nil {
			t.Errorf("DROP ROLE %s: %v", role, err)
		}
	})
	var db string
	if err := admin.QueryRow(ctx, "SELECT current_database()").Scan(&db); err != nil {
		t.Fatal(err)
	}
	s, r := quoteIdent(schema), quoteIdent(role)
	for _, stmt := range []string{
		"GRANT CONNECT ON DATABASE " + quoteIdent(db) + " TO " + r,
		"GRANT USAGE, CREATE ON SCHEMA " + s + " TO " + r,
		"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA " + s + " TO " + r,
		"GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA " + s + " TO " + r,
		"GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA " + s + " TO " + r,
	} {
		if _, err := admin.Exec(ctx, stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	u.User = url.UserPassword(role, password)
	return u.String()
}

// A role that may use a migrated schema but owns none of its tables, nor
// may create schemas, can run queues and workers: the ledger is read first,
// and no DDL runs when it is up to date. SkipMigrations refuses a schema
// that was not migrated, which Migrate does as a deployment step.
func TestANonOwnerRoleRunsOnAMigratedSchema(t *testing.T) {
	ownerURL := testURL(t)
	ctx := testCtx(t)
	schema := newSchema(t)
	queue := fmt.Sprintf("app-%d", time.Now().UnixNano())

	skipping, err := bullmq.NewQueue(queue, &bullmq.QueueOptions{
		Backend: New(Options{ConnString: ownerURL, Schema: schema, SkipMigrations: true}),
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = skipping.Count(ctx)
	_ = skipping.Close()
	var cfgErr *bullmq.ConfigError
	if !errors.As(err, &cfgErr) || !strings.Contains(err.Error(), "Migrate") {
		t.Fatalf("Count on an unmigrated schema with SkipMigrations = %v, want a ConfigError pointing at Migrate", err)
	}
	var exists bool
	if err := adminConn(t).QueryRow(ctx, "SELECT to_regnamespace($1) IS NOT NULL", quoteIdent(schema)).Scan(&exists); err != nil || exists {
		t.Fatalf("SkipMigrations created the schema (%v)", err)
	}

	if err := Migrate(ctx, Options{ConnString: ownerURL, Schema: schema}); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	if got := ledger(t, schema); len(got) == 0 {
		t.Fatal("Migrate left an empty ledger")
	}
	appURL := newAppRole(t, ctx, schema)

	for _, skip := range []bool{false, true} {
		t.Run(fmt.Sprintf("SkipMigrations=%v", skip), func(t *testing.T) {
			factory := New(Options{ConnString: appURL, Schema: schema, SkipMigrations: skip})
			q, err := bullmq.NewQueue(queue, &bullmq.QueueOptions{Backend: factory})
			if err != nil {
				t.Fatal(err)
			}
			defer q.Close()
			job, err := q.Add(ctx, "job", map[string]string{"foo": "bar"}, nil)
			if err != nil {
				t.Fatalf("Add as a non-owner role: %v", err)
			}
			w, err := bullmq.NewWorker(queue, func(context.Context, *bullmq.Job) (any, error) { return "done", nil },
				&bullmq.WorkerOptions{Backend: factory, DrainDelay: 200 * time.Millisecond})
			if err != nil {
				t.Fatal(err)
			}
			runCtx, cancel := context.WithCancel(context.Background())
			stopped := make(chan struct{})
			go func() {
				defer close(stopped)
				_ = w.Run(runCtx)
			}()
			defer func() {
				cancel()
				<-stopped
				_ = w.Close()
			}()
			eventually(t, "the job to complete", func() bool {
				state, err := q.JobState(ctx, job.ID)
				return err == nil && state == bullmq.StateCompleted
			})
		})
	}
}
