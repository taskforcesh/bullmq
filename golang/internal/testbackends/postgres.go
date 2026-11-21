package testbackends

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	bullmq "github.com/taskforcesh/bullmq-go"
	"github.com/taskforcesh/bullmq-go/postgresbackend"
)

// PostgresSchema is the schema the behaviour suite uses, so it never touches
// the default "bullmq" schema of the database.
const PostgresSchema = "bullmq_go_test"

// PostgresURL is the PostgreSQL database used by the tests: POSTGRES_URL, or
// "" to skip PostgreSQL.
func PostgresURL() string { return os.Getenv("POSTGRES_URL") }

var postgresPing = sync.OnceValue(func() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, PostgresURL())
	if err != nil {
		return err
	}
	defer conn.Close(context.Background())
	return conn.Ping(ctx)
})

// Postgres returns the PostgreSQL entry of the matrix for the database at
// url.
func Postgres(url string) Backend {
	return Backend{
		Name:      "postgres",
		Factory:   postgresbackend.New(postgresbackend.Options{ConnString: url, Schema: PostgresSchema}),
		Fixture:   postgresFixture{},
		available: postgresPing,
	}
}

type postgresFixture struct{}

func postgresOf(b bullmq.Backend) (*postgresbackend.Backend, error) {
	pb, ok := b.(*postgresbackend.Backend)
	if !ok {
		return nil, fmt.Errorf("testbackends: %T is not a PostgreSQL backend", b)
	}
	return pb, nil
}

// exec runs sql with the queue name as $1 and the job id as $2. The table
// names in sql are qualified with the schema by the caller through %s.
func (postgresFixture) exec(ctx context.Context, b bullmq.Backend, sql string, args ...any) error {
	pb, err := postgresOf(b)
	if err != nil {
		return err
	}
	_, err = pb.Pool().Exec(ctx, fmt.Sprintf(sql, `"`+pb.Schema()+`"`), append([]any{pb.QueueName()}, args...)...)
	return err
}

func (postgresFixture) queryRow(ctx context.Context, b bullmq.Backend, sql string, args []any, dest ...any) error {
	pb, err := postgresOf(b)
	if err != nil {
		return err
	}
	return pb.Pool().QueryRow(ctx, fmt.Sprintf(sql, `"`+pb.Schema()+`"`), append([]any{pb.QueueName()}, args...)...).Scan(dest...)
}

func (f postgresFixture) DeleteLock(ctx context.Context, b bullmq.Backend, jobID string) error {
	return f.exec(ctx, b, `UPDATE %s.job SET lock_token = NULL, locked_until_ms = NULL WHERE queue = $1 AND id = $2`, jobID)
}

func (f postgresFixture) SetLock(ctx context.Context, b bullmq.Backend, jobID, token string, ttl time.Duration) error {
	return f.exec(ctx, b, `UPDATE %s.job SET lock_token = $3, locked_until_ms = $4 WHERE queue = $1 AND id = $2`,
		jobID, token, time.Now().Add(ttl).UnixMilli())
}

func (f postgresFixture) LockExists(ctx context.Context, b bullmq.Backend, jobID string) (bool, error) {
	var held bool
	err := f.queryRow(ctx, b,
		`SELECT lock_token IS NOT NULL AND COALESCE(locked_until_ms > $3, false) FROM %s.job WHERE queue = $1 AND id = $2`,
		[]any{jobID, time.Now().UnixMilli()}, &held)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return held, err
}

func (f postgresFixture) SetFailure(ctx context.Context, b bullmq.Backend, jobID, reason string, stacktrace []string) error {
	trace, err := json.Marshal(stacktrace)
	if err != nil {
		return err
	}
	return f.exec(ctx, b, `UPDATE %s.job SET failed_reason = $3, stacktrace = $4::jsonb WHERE queue = $1 AND id = $2`,
		jobID, reason, string(trace))
}

func (f postgresFixture) PendingDependencies(ctx context.Context, b bullmq.Backend, jobID string) (int64, error) {
	var n int64
	err := f.queryRow(ctx, b,
		`SELECT count(*) FROM %s.job_dependency WHERE parent_queue = $1 AND parent_id = $2 AND status = 'pending'`,
		[]any{jobID}, &n)
	return n, err
}

func (f postgresFixture) Deduplication(ctx context.Context, b bullmq.Backend, dedupID string) (string, time.Duration, bool, error) {
	var (
		jobID  string
		expire *int64
	)
	now := time.Now().UnixMilli()
	err := f.queryRow(ctx, b,
		`SELECT job_id, expire_at_ms FROM %s.dedup WHERE queue = $1 AND dedup_id = $2 AND (expire_at_ms IS NULL OR expire_at_ms > $3)`,
		[]any{dedupID, now}, &jobID, &expire)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", 0, false, nil
	}
	if err != nil {
		return "", 0, false, err
	}
	ttl := time.Duration(-1)
	if expire != nil {
		ttl = time.Duration(*expire-now) * time.Millisecond
	}
	return jobID, ttl, true, nil
}

func (f postgresFixture) JobDeduplicationID(ctx context.Context, b bullmq.Backend, jobID string) (string, error) {
	var id *string
	err := f.queryRow(ctx, b, `SELECT dedup_id FROM %s.job WHERE queue = $1 AND id = $2`, []any{jobID}, &id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && id == nil) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return *id, nil
}
