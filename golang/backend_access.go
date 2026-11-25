package bullmq

// Backend returns the datastore backend of the worker. Type-assert it to the
// concrete backend, for example *redisbackend.Backend, to reach
// datastore-specific features such as its dedicated blocking client.
func (w *Worker) Backend() Backend { return w.backend }

// Backend returns the datastore backend of the listener. Type-assert it to
// the concrete backend, for example *redisbackend.Backend, to reach
// datastore-specific features such as its dedicated blocking client.
func (qe *QueueEvents) Backend() Backend { return qe.backend }

// Backend returns the datastore backend of the producer, which reaches every
// queue of its flows. Type-assert it to the concrete backend, for example
// *redisbackend.Backend, to reach datastore-specific features.
func (fp *FlowProducer) Backend() Backend { return fp.backend }
