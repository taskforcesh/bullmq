package redisbackend

import (
	"context"
	"fmt"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/redis/go-redis/v9"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// clusterTestPrefix keeps every key of a test queue in one hash slot.
const clusterTestPrefix = "{bullmq-go-test}"

// clusterAddrs returns the seed nodes of the Redis Cluster in
// REDIS_CLUSTER_ADDRS (comma-separated), or skips the test.
func clusterAddrs(t *testing.T) []string {
	t.Helper()
	v := os.Getenv("REDIS_CLUSTER_ADDRS")
	if v == "" {
		t.Skip("REDIS_CLUSTER_ADDRS is not set")
	}
	return strings.Split(v, ",")
}

// newTestCluster returns a cluster client that is closed when the test ends.
func newTestCluster(t *testing.T) *redis.ClusterClient {
	t.Helper()
	cluster := redis.NewClusterClient(&redis.ClusterOptions{Addrs: clusterAddrs(t)})
	t.Cleanup(func() { _ = cluster.Close() })
	if err := cluster.ForEachShard(testContext(t), func(ctx context.Context, c *redis.Client) error {
		return c.Ping(ctx).Err()
	}); err != nil {
		t.Fatalf("cluster is not available: %v", err)
	}
	return cluster
}

// shardAddrs returns the address of every server of a sharded client.
func shardAddrs(t *testing.T, c shardedClient) []string {
	t.Helper()
	var (
		mu    sync.Mutex
		addrs []string
	)
	if err := c.ForEachShard(testContext(t), func(_ context.Context, node *redis.Client) error {
		mu.Lock()
		defer mu.Unlock()
		addrs = append(addrs, node.Options().Addr)
		return nil
	}); err != nil {
		t.Fatalf("ForEachShard: %v", err)
	}
	slices.Sort(addrs)
	return addrs
}

// openNamedConns opens n connections named name to addr, closed when the test
// ends.
func openNamedConns(t *testing.T, addr, name string, n int) {
	t.Helper()
	for range n {
		c := redis.NewClient(&redis.Options{Addr: addr, ClientName: name, PoolSize: 1})
		t.Cleanup(func() { _ = c.Close() })
		if err := c.Ping(testContext(t)).Err(); err != nil {
			t.Fatalf("Ping %s: %v", addr, err)
		}
	}
}

// A ring reports one CLIENT LIST per shard, as a cluster does per node.
func TestGetClientListAsksEveryRingShard(t *testing.T) {
	requireRedis(t)
	ctx := testContext(t)
	ring := redis.NewRing(&redis.RingOptions{Addrs: map[string]string{"one": redisAddr(), "two": redisAddr()}})
	defer ring.Close()
	q, err := bullmq.NewQueue(testQueueName(t), &bullmq.QueueOptions{Backend: New(Options{Client: ring})})
	if err != nil {
		t.Fatalf("NewQueue: %v", err)
	}
	defer q.Close()
	rb := redisOf(t, q)
	openNamedConns(t, redisAddr(), rb.ClientName(":w:ring-worker"), 1)

	lists, err := rb.GetClientList(ctx)
	if err != nil {
		t.Fatalf("GetClientList: %v", err)
	}
	if len(lists) != 2 {
		t.Fatalf("GetClientList returned %d lists, want one per shard (2)", len(lists))
	}
	workers, err := q.Workers(ctx)
	if err != nil || len(workers) != 1 || workers[0].Name != "ring-worker" {
		t.Fatalf("Workers = %+v, %v; want ring-worker", workers, err)
	}
}

// On a cluster every node, master or replica, reports its own connections,
// and Workers lists those of the node with the most workers, as Node does.
func TestWorkersOnRedisCluster(t *testing.T) {
	cluster := newTestCluster(t)
	ctx := testContext(t)
	q, err := bullmq.NewQueue(testQueueName(t), &bullmq.QueueOptions{
		Backend: New(Options{Client: cluster, Prefix: clusterTestPrefix}),
	})
	if err != nil {
		t.Fatalf("NewQueue: %v", err)
	}
	defer q.Close()
	rb := redisOf(t, q)

	nodes := shardAddrs(t, cluster)
	if len(nodes) < 2 {
		t.Fatalf("the cluster has %d nodes, want several", len(nodes))
	}
	// Node i holds i+1 workers, so the last node holds the most.
	for i, addr := range nodes {
		openNamedConns(t, addr, rb.ClientName(fmt.Sprintf(":w:node%d", i)), i+1)
	}

	lists, err := rb.GetClientList(ctx)
	if err != nil {
		t.Fatalf("GetClientList: %v", err)
	}
	if len(lists) != len(nodes) {
		t.Fatalf("GetClientList returned %d lists, want one per node (%d)", len(lists), len(nodes))
	}
	workers, err := q.Workers(ctx)
	if err != nil {
		t.Fatalf("Workers: %v", err)
	}
	want := fmt.Sprintf("node%d", len(nodes)-1)
	if len(workers) != len(nodes) {
		t.Fatalf("Workers returned %d workers, want the %d of %s", len(workers), len(nodes), want)
	}
	for _, w := range workers {
		if w.Name != want {
			t.Errorf("worker %q listed, want only %s", w.Name, want)
		}
	}
}
