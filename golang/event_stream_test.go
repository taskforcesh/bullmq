package bullmq_test

import (
	"context"
	"errors"
	"testing"
	"time"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// A custom event published with a QueueEventsProducer reaches QueueEvents
// with its name and fields, as with Node's publishEvent.
func TestQueueEventsProducerPublishesCustomEvents(t *testing.T) {
	forEachBackend(t, testQueueEventsProducerPublishesCustomEvents)
}

func testQueueEventsProducerPublishesCustomEvents(t *testing.T, be testBackend) {
	ctx := testContext(t)
	q := newTestQueue(t, be, nil)
	producer, err := bullmq.NewQueueEventsProducer(q.Name(), &bullmq.QueueEventsProducerOptions{Backend: be.Factory})
	if err != nil {
		t.Fatalf("NewQueueEventsProducer: %v", err)
	}
	defer producer.Close()

	var cfgErr *bullmq.ConfigError
	if _, err := producer.PublishEvent(ctx, "", nil, 0); !errors.As(err, &cfgErr) {
		t.Errorf("PublishEvent without a name = %v, want a ConfigError", err)
	}
	if _, err := producer.PublishEvent(ctx, "example", map[string]any{"event": "x"}, 0); !errors.As(err, &cfgErr) {
		t.Errorf("PublishEvent with an event field = %v, want a ConfigError", err)
	}

	qe, err := bullmq.NewQueueEvents(q.Name(), &bullmq.QueueEventsOptions{
		Backend: be.Factory, LastEventID: "0", BlockingTimeout: 200 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("NewQueueEvents: %v", err)
	}
	runCtx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = qe.Run(runCtx)
	}()
	defer func() {
		cancel()
		<-done
		_ = qe.Close()
	}()

	id, err := producer.PublishEvent(ctx, "example", map[string]any{
		"custom": "value",
		"count":  3,
		"nested": map[string]int{"a": 1},
	}, 0)
	if err != nil || id == "" {
		t.Fatalf("PublishEvent = %q, %v", id, err)
	}
	timeout := time.After(10 * time.Second)
	for {
		select {
		case ev, ok := <-qe.Events():
			if !ok {
				t.Fatal("the events channel closed")
			}
			if ev.Event != "example" {
				continue
			}
			want := map[string]string{"event": "example", "custom": "value", "count": "3", "nested": `{"a":1}`}
			for k, v := range want {
				if ev.Data[k] != v {
					t.Errorf("Data[%q] = %q, want %q", k, ev.Data[k], v)
				}
			}
			if ev.ID != id {
				t.Errorf("event id %q, PublishEvent returned %q", ev.ID, id)
			}
			return
		case <-timeout:
			t.Fatal("the custom event was not delivered")
		}
	}
}
