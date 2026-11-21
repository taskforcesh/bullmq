package postgresbackend

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	bullmq "github.com/taskforcesh/bullmq-go"
)

// eventReadBatch is the most events read per round trip.
const eventReadBatch = 100

// LastEventID returns the id of the newest event of the queue, or "0-0" when
// there is none.
func (b *Backend) LastEventID(ctx context.Context) (string, error) {
	maxID, err := b.maxEventID(ctx)
	if err != nil {
		return "", err
	}
	if maxID == 0 {
		return "0-0", nil
	}
	return strconv.FormatInt(maxID, 10), nil
}

func (b *Backend) maxEventID(ctx context.Context) (int64, error) {
	var maxID int64
	err := b.queryRow(ctx, "read_events_max", []any{b.name}, &maxID)
	return maxID, err
}

// eventCursor parses an event id. Event ids are numbers on PostgreSQL; the
// Redis stream forms "0-0" and "<ms>-<seq>" are accepted by their first part,
// and "$" means the newest event.
func (b *Backend) eventCursor(ctx context.Context, id string) (int64, error) {
	if id == "$" {
		return b.maxEventID(ctx)
	}
	head, _, _ := strings.Cut(id, "-")
	n, err := strconv.ParseInt(head, 10, 64)
	if err != nil {
		return 0, configError("invalid event id %q", id)
	}
	return n, nil
}

// ReadEvents returns the events newer than lastID, waiting up to block for
// one to be published. The wait listens for notifications on the events
// channel with the dedicated events connection.
func (b *Backend) ReadEvents(ctx context.Context, lastID string, block time.Duration) ([]bullmq.QueueEvent, error) {
	if b.isClosed() {
		return nil, errClosed
	}
	cursor, err := b.eventCursor(ctx, lastID)
	if err != nil {
		return nil, err
	}
	if err := b.events.ensure(ctx); err != nil {
		return nil, err
	}
	signalled := b.events.signalled()
	events, err := b.fetchEvents(ctx, cursor)
	if err != nil || len(events) > 0 {
		return events, err
	}

	// As with Redis XREAD, a zero block waits until an event arrives.
	var timeout <-chan time.Time
	if block > 0 {
		t := time.NewTimer(block)
		defer t.Stop()
		timeout = t.C
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-b.closing:
		return nil, nil
	case <-timeout:
		return nil, nil
	case <-signalled:
		return b.fetchEvents(ctx, cursor)
	}
}

func (b *Backend) fetchEvents(ctx context.Context, cursor int64) ([]bullmq.QueueEvent, error) {
	var events []bullmq.QueueEvent
	err := b.run(ctx, "read_events", func(ctx context.Context, sql string) error {
		rows, err := b.pool.Query(ctx, sql, b.name, cursor, eventReadBatch)
		if err != nil {
			return err
		}
		var (
			id   int64
			name string
			data []byte
		)
		_, err = pgx.ForEachRow(rows, []any{&id, &name, &data}, func() error {
			events = append(events, newQueueEvent(id, name, data))
			return nil
		})
		return err
	})
	return events, err
}

// newQueueEvent builds an event with the fields of a Redis stream entry:
// strings as they are, other JSON values as their JSON text.
func newQueueEvent(id int64, name string, data []byte) bullmq.QueueEvent {
	ev := bullmq.QueueEvent{
		ID:    strconv.FormatInt(id, 10),
		Event: name,
		Data:  map[string]string{"event": name},
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(data, &fields) == nil {
		for k, raw := range fields {
			var s string
			if json.Unmarshal(raw, &s) == nil {
				ev.Data[k] = s
			} else {
				ev.Data[k] = string(raw)
			}
		}
	}
	ev.Data["event"] = name
	ev.JobID = ev.Data["jobId"]
	return ev
}
