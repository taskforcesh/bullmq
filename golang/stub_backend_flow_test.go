package bullmq

import (
	"context"
	"strings"
	"sync"
)

// flowStubBackend is a Backend for FlowProducer unit tests: it records the
// flows handed to AddFlow instead of storing them. The methods it does not
// override panic through the nil embedded interface.
type flowStubBackend struct {
	Backend
	name  string
	state *flowStubState
}

type flowStubState struct {
	mu     sync.Mutex
	flows  [][]FlowEntry
	closed []string
	// ids, when set, replaces the ids AddFlow returns.
	ids func(entries []FlowEntry) []string
}

const flowStubPrefix = "stub:"

func newFlowStubFactory(state *flowStubState) BackendFactory {
	return func(name string, _ BackendOptions) (Backend, error) {
		return &flowStubBackend{name: name, state: state}, nil
	}
}

func (b *flowStubBackend) QueueName() string { return b.name }

func (b *flowStubBackend) QualifiedName() string { return flowStubPrefix + b.name }

func (b *flowStubBackend) ResolveParent(parent *ParentOptions) (*ParentKeys, string, error) {
	queueKey := flowStubPrefix + strings.TrimPrefix(parent.Queue, flowStubPrefix)
	return &ParentKeys{ID: parent.ID, QueueKey: queueKey}, queueKey + ":" + parent.ID, nil
}

func (b *flowStubBackend) ForQueue(name string) (Backend, error) {
	return &flowStubBackend{name: strings.TrimPrefix(name, flowStubPrefix), state: b.state}, nil
}

func (b *flowStubBackend) AddFlow(_ context.Context, entries []FlowEntry) ([]string, error) {
	b.state.mu.Lock()
	defer b.state.mu.Unlock()
	b.state.flows = append(b.state.flows, entries)
	if b.state.ids != nil {
		return b.state.ids(entries), nil
	}
	ids := make([]string, len(entries))
	for i, e := range entries {
		ids[i] = e.JobID
	}
	return ids, nil
}

func (b *flowStubBackend) Close() error {
	b.state.mu.Lock()
	defer b.state.mu.Unlock()
	b.state.closed = append(b.state.closed, b.name)
	return nil
}
