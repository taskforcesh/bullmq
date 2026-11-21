package bullmq

import "context"

// TrimEvents trims the queue's event stream to about maxLength events, as
// Node's trimEvents does, and returns how many it removed. Redis trims
// approximately (XTRIM MAXLEN ~), so a few more events may be left. The
// PostgreSQL backend can't (an error wrapping ErrNotSupported, as Node's
// throws): it trims the stream to QueueOptions.EventsMaxLen as it adds
// events.
func (q *Queue) TrimEvents(ctx context.Context, maxLength int64) (int64, error) {
	if maxLength < 0 {
		return 0, configError("TrimEvents maxLength must not be negative, got %d", maxLength)
	}
	return q.backend.TrimEvents(ctx, maxLength)
}
