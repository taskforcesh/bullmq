package bullmq

import (
	"context"
	"sync"
)

// schedulerStub is a Backend that records the job scheduler operations made
// on it, for unit tests of the scheduling logic.
type schedulerStub struct {
	stubBackend

	mu      sync.Mutex
	added   []NewJobScheduler
	updates []schedulerUpdate
	// isScheduler answers IsJobScheduler.
	isScheduler bool
	// updateErrs are returned, in order, by UpdateJobSchedulerNextMillis.
	updateErrs []error
	isChecked  []string
}

type schedulerUpdate struct {
	id         string
	nextMillis int64
	data       string
	jobOpts    *JobOptions
	producerID string
}

func (s *schedulerStub) AddJobScheduler(_ context.Context, js NewJobScheduler) (string, int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.added = append(s.added, js)
	delay := int64(0)
	if js.JobOpts.Delay != nil {
		delay = *js.JobOpts.Delay
	}
	return schedulerJobID(js.ID, js.NextMillis), delay, nil
}

func (s *schedulerStub) UpdateJobSchedulerNextMillis(_ context.Context, id string, nextMillis int64, data []byte, jobOpts *JobOptions, producerID string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.updateErrs) > 0 {
		err := s.updateErrs[0]
		s.updateErrs = s.updateErrs[1:]
		if err != nil {
			return "", err
		}
	}
	s.updates = append(s.updates, schedulerUpdate{id, nextMillis, string(data), jobOpts, producerID})
	return schedulerJobID(id, nextMillis), nil
}

func (s *schedulerStub) IsJobScheduler(_ context.Context, id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.isChecked = append(s.isChecked, id)
	return s.isScheduler, nil
}

func (s *schedulerStub) recorded() ([]NewJobScheduler, []schedulerUpdate, []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.added, s.updates, s.isChecked
}
