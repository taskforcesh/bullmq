package redisbackend

import (
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// Without an Addr, the backend connects where ioredis and go-redis do, which
// also reaches a server bound only to ::1.
func TestDefaultAddrIsLocalhost(t *testing.T) {
	rdb, owned := Options{}.build()
	defer rdb.Close()
	blocking, _ := Options{}.buildBlocking("name", time.Second)
	defer blocking.Close()
	for what, client := range map[string]redis.UniversalClient{"client": rdb, "blocking client": blocking} {
		c, ok := client.(*redis.Client)
		if !ok {
			t.Fatalf("default %s is a %T, want a *redis.Client", what, client)
		}
		if addr := c.Options().Addr; addr != DefaultAddr || DefaultAddr != "localhost:6379" {
			t.Errorf("default %s connects to %s, want localhost:6379", what, addr)
		}
	}
	if !owned {
		t.Error("the default client is not owned by the backend")
	}
}
