package bullmq

import (
	"context"
	"encoding/json"
	"fmt"
)

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

// DefaultMaxEvents is the maxEvents of QueueEventsProducer.PublishEvent
// when it is 0, as in Node.js.
const DefaultMaxEvents int64 = 1000

// QueueEventsProducerOptions configures a QueueEventsProducer.
type QueueEventsProducerOptions struct {
	// Backend builds the datastore backend. It is required.
	Backend BackendFactory
}

// QueueEventsProducer publishes custom events on a queue's event stream, as
// Node's QueueEventsProducer does. The QueueEvents of every runtime receive
// them like the events of jobs: QueueEvent.Event is the event's name and
// QueueEvent.Data holds its fields.
//
// A QueueEventsProducer is safe for concurrent use.
type QueueEventsProducer struct {
	backend Backend
}

// NewQueueEventsProducer creates a producer of custom events for the queue
// called name.
func NewQueueEventsProducer(name string, opts *QueueEventsProducerOptions) (*QueueEventsProducer, error) {
	if opts == nil {
		opts = &QueueEventsProducerOptions{}
	}
	backend, err := resolveBackend(opts.Backend, name, BackendOptions{})
	if err != nil {
		return nil, err
	}
	return &QueueEventsProducer{backend: backend}, nil
}

// PublishEvent appends an event called eventName to the event stream, with
// fields, and returns its id, as Node's publishEvent({eventName, ...fields},
// maxEvents) does. String values are stored as they are, and other values
// as their JSON encoding; a field can't be called "event", which holds the
// name. On Redis the stream is trimmed to about maxEvents events (0 means
// DefaultMaxEvents); PostgreSQL trims it to the queue's EventsMaxLen
// instead. Don't use the names of the events of jobs (completed, failed,
// ...), which listeners would take for them.
func (p *QueueEventsProducer) PublishEvent(ctx context.Context, eventName string, fields map[string]any, maxEvents int64) (string, error) {
	if eventName == "" {
		return "", configError("PublishEvent needs an event name")
	}
	if maxEvents < 0 {
		return "", configError("PublishEvent maxEvents must not be negative, got %d", maxEvents)
	}
	if maxEvents == 0 {
		maxEvents = DefaultMaxEvents
	}
	values := make(map[string]string, len(fields))
	for k, v := range fields {
		if k == "event" {
			return "", configError(`PublishEvent: the field "event" holds the event name`)
		}
		if s, ok := v.(string); ok {
			values[k] = s
			continue
		}
		raw, err := json.Marshal(v)
		if err != nil {
			return "", fmt.Errorf("bullmq: PublishEvent: field %q: %w", k, err)
		}
		values[k] = string(raw)
	}
	return p.backend.PublishEvent(ctx, eventName, values, maxEvents)
}

// Backend returns the datastore backend of the producer.
func (p *QueueEventsProducer) Backend() Backend { return p.backend }

// Close releases the connections the producer owns.
func (p *QueueEventsProducer) Close() error { return p.backend.Close() }
