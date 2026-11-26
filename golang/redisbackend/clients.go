package redisbackend

import "github.com/redis/go-redis/v9"

// BlockingClient returns the client of the blocking reads (BZPOPMIN, XREAD):
// for a worker or a queue events listener, the dedicated client derived from
// Options, or the shared client when it could not be derived (a *redis.Ring);
// for anything else, the shared client, as Client returns it. Commands sent
// through it are never auto-pipelined. Don't close it: the backend does.
func (b *Backend) BlockingClient() redis.UniversalClient { return b.blocking }
