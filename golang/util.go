package bullmq

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strconv"
	"time"
)

// randomID returns a 128-bit random identifier, used for worker ids and lock
// tokens.
func randomID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand never fails on the platforms Go supports.
		panic(err)
	}
	return hex.EncodeToString(b[:])
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}

// parseInt leniently parses an integer stored as text, accepting floats and
// returning 0 for anything else.
func parseInt(s string) int64 {
	if s == "" {
		return 0
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		f, ferr := strconv.ParseFloat(s, 64)
		if ferr != nil {
			return 0
		}
		return int64(f)
	}
	return n
}

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
