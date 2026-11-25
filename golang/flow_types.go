package bullmq

import "encoding/json"

// FlowEntry is a job of a flow handed to [Backend.AddFlow].
type FlowEntry struct {
	// QueueName is the queue the job is added to.
	QueueName string
	// JobID is the id the job is stored under: its custom id, or one the
	// FlowProducer generated, since children must know their parent's id
	// before it is stored. Job.Opts.JobID only holds a custom id, which is
	// what the other ports store in the job options.
	JobID string
	// Job is the validated job.
	Job NewJob
	// WaitingChildren adds the job in the waiting-children state: it is a
	// parent, and its children follow it in the entries.
	WaitingChildren bool
}

// DependenciesOptions selects the children returned by [Job.Dependencies]:
// only the groups whose page is set are returned, one page each.
type DependenciesOptions struct {
	// Processed pages through the completed children.
	Processed *DependencyPage
	// Unprocessed pages through the children that have not finished yet.
	Unprocessed *DependencyPage
	// Ignored pages through the children whose failure was ignored.
	Ignored *DependencyPage
	// Failed pages through the children that failed their parent.
	Failed *DependencyPage
}

// DependencyPage requests a page of a group of children.
type DependencyPage struct {
	// Cursor is where the page starts: 0 for the first page, then the next
	// cursor reported with the previous page.
	Cursor uint64
	// Count is how many children to return. Defaults to 20. On Redis it is
	// a hint for the processed, unprocessed and ignored groups, as the COUNT
	// of HSCAN and SSCAN: the children of a small group are all returned.
	Count int64
}

// Dependencies are the children of a parent job grouped by status. Children
// are identified by their key, `{QualifiedName}:{id}` (for example
// `bull:emails:42` on Redis and `emails:42` on PostgreSQL), which works
// across queues.
//
// A group that was not requested is nil. A next cursor is 0 once the last
// page of its group was returned.
type Dependencies struct {
	// Processed maps the key of every completed child to its return value
	// (JSON).
	Processed map[string]json.RawMessage
	// Unprocessed lists the keys of the children that have not finished.
	Unprocessed []string
	// Ignored maps the key of every child whose failure was ignored
	// (IgnoreDependencyOnFailure or ContinueParentOnFailure) to its failure
	// reason.
	Ignored map[string]string
	// Failed lists the keys of the children that failed with
	// FailParentOnFailure.
	Failed []string

	NextProcessedCursor   uint64
	NextUnprocessedCursor uint64
	NextIgnoredCursor     uint64
	NextFailedCursor      uint64
}

// DependencyCounts is the number of children of a parent job in each status
// (see [Dependencies]).
type DependencyCounts struct {
	Processed   int64
	Unprocessed int64
	Ignored     int64
	Failed      int64
}
