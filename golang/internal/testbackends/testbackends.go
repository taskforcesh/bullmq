// Package testbackends lists the datastores that the shared behaviour tests
// of package bullmq run against, together with the datastore-level fixtures
// some of those tests need. Only tests import it.
//
// Redis is always included. PostgreSQL is included when POSTGRES_URL is set.
// A new backend plugs into the matrix by adding an entry to [All] with a
// [Fixture] implementation.
package testbackends

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	bullmq "github.com/taskforcesh/bullmq-go"
	"github.com/taskforcesh/bullmq-go/redisbackend"
)

// Backend is one datastore the behaviour suite runs against.
type Backend struct {
	// Name labels the subtests run against this datastore.
	Name string
	// Factory builds the backends of the queues, workers and queue events
	// created by a test.
	Factory bullmq.BackendFactory
	// Fixture manipulates and inspects the datastore directly, for tests
	// that simulate failures or check stored state the public API does not
	// expose.
	Fixture Fixture

	// available reports, once per test run, whether the datastore can be
	// reached; tests are skipped when it cannot.
	available func() error
}

// Require skips t when the datastore is not reachable.
func (b Backend) Require(t testing.TB) {
	t.Helper()
	if b.available == nil {
		return
	}
	if err := b.available(); err != nil {
		t.Skipf("%s is not available: %v", b.Name, err)
	}
}

// Fixture is implemented by every datastore in the matrix. All methods take
// the backend of the queue under test, as returned by Queue.Backend.
type Fixture interface {
	// DeleteLock removes the lock of an active job, as if it had expired or
	// another worker had taken the job over.
	DeleteLock(ctx context.Context, b bullmq.Backend, jobID string) error
	// SetLock stores a lock owned by token on a job, expiring after ttl.
	SetLock(ctx context.Context, b bullmq.Backend, jobID, token string, ttl time.Duration) error
	// LockExists reports whether a job's lock is held.
	LockExists(ctx context.Context, b bullmq.Backend, jobID string) (bool, error)
	// SetFailure overwrites the failure reason and stack trace stored on a
	// job, as another worker recording a failure would.
	SetFailure(ctx context.Context, b bullmq.Backend, jobID, reason string, stacktrace []string) error
	// PendingDependencies returns how many children a parent job still
	// waits for.
	PendingDependencies(ctx context.Context, b bullmq.Backend, jobID string) (int64, error)
	// Deduplication returns the job a deduplication id points at and the
	// time left before the entry expires (-1 when it never expires). ok is
	// false when no entry exists.
	Deduplication(ctx context.Context, b bullmq.Backend, dedupID string) (jobID string, ttl time.Duration, ok bool, err error)
	// JobDeduplicationID returns the deduplication id stored on a job.
	JobDeduplicationID(ctx context.Context, b bullmq.Backend, jobID string) (string, error)
}

// All returns every datastore available to this test run.
func All() []Backend {
	backends := []Backend{Redis()}
	if url := PostgresURL(); url != "" {
		backends = append(backends, Postgres(url))
	}
	return backends
}

// RedisAddr is the Redis server used by the tests: REDIS_ADDR, or
// 127.0.0.1:6379 when it is unset.
func RedisAddr() string {
	if addr := os.Getenv("REDIS_ADDR"); addr != "" {
		return addr
	}
	return "127.0.0.1:6379"
}

var redisPing = sync.OnceValue(func() error {
	rdb := redis.NewClient(&redis.Options{Addr: RedisAddr()})
	defer rdb.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return rdb.Ping(ctx).Err()
})

// Redis returns the Redis entry of the matrix.
func Redis() Backend {
	return Backend{
		Name:      "redis",
		Factory:   redisbackend.New(redisbackend.Options{Addr: RedisAddr()}),
		Fixture:   redisFixture{},
		available: redisPing,
	}
}

type redisFixture struct{}

func redisOf(b bullmq.Backend) (*redisbackend.Backend, error) {
	rb, ok := b.(*redisbackend.Backend)
	if !ok {
		return nil, fmt.Errorf("testbackends: %T is not a Redis backend", b)
	}
	return rb, nil
}

func (redisFixture) DeleteLock(ctx context.Context, b bullmq.Backend, jobID string) error {
	rb, err := redisOf(b)
	if err != nil {
		return err
	}
	return rb.Client().Del(ctx, rb.Keys().JobLock(jobID)).Err()
}

func (redisFixture) SetLock(ctx context.Context, b bullmq.Backend, jobID, token string, ttl time.Duration) error {
	rb, err := redisOf(b)
	if err != nil {
		return err
	}
	return rb.Client().Set(ctx, rb.Keys().JobLock(jobID), token, ttl).Err()
}

func (redisFixture) LockExists(ctx context.Context, b bullmq.Backend, jobID string) (bool, error) {
	rb, err := redisOf(b)
	if err != nil {
		return false, err
	}
	n, err := rb.Client().Exists(ctx, rb.Keys().JobLock(jobID)).Result()
	return n == 1, err
}

func (redisFixture) SetFailure(ctx context.Context, b bullmq.Backend, jobID, reason string, stacktrace []string) error {
	rb, err := redisOf(b)
	if err != nil {
		return err
	}
	trace, err := json.Marshal(stacktrace)
	if err != nil {
		return err
	}
	return rb.Client().HSet(ctx, rb.Keys().Job(jobID),
		"failedReason", reason,
		"stacktrace", string(trace),
	).Err()
}

func (redisFixture) PendingDependencies(ctx context.Context, b bullmq.Backend, jobID string) (int64, error) {
	rb, err := redisOf(b)
	if err != nil {
		return 0, err
	}
	return rb.Client().SCard(ctx, rb.Keys().Dependencies(jobID)).Result()
}

func (redisFixture) Deduplication(ctx context.Context, b bullmq.Backend, dedupID string) (string, time.Duration, bool, error) {
	rb, err := redisOf(b)
	if err != nil {
		return "", 0, false, err
	}
	key := rb.Keys().Base() + ":de:" + dedupID
	jobID, err := rb.Client().Get(ctx, key).Result()
	if errors.Is(err, redis.Nil) {
		return "", 0, false, nil
	}
	if err != nil {
		return "", 0, false, err
	}
	ttl, err := rb.Client().PTTL(ctx, key).Result()
	if err != nil {
		return "", 0, false, err
	}
	if ttl < 0 {
		ttl = -1
	}
	return jobID, ttl, true, nil
}

func (redisFixture) JobDeduplicationID(ctx context.Context, b bullmq.Backend, jobID string) (string, error) {
	rb, err := redisOf(b)
	if err != nil {
		return "", err
	}
	id, err := rb.Client().HGet(ctx, rb.Keys().Job(jobID), "deid").Result()
	if errors.Is(err, redis.Nil) {
		return "", nil
	}
	return id, err
}
