package bullmq

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"sync"
)

// ErrFlowProducerClosed is returned by the operations of a closed
// [FlowProducer].
var ErrFlowProducerClosed = errors.New("bullmq: flow producer is closed")

// flowProducerBackendName names the backend a FlowProducer builds with its
// factory. A FlowProducer is not bound to a queue: it only derives the
// backends of the queues of its flows from it (Backend.ForQueue), as Node's
// FlowProducer builds its backend for an empty queue name.
const flowProducerBackendName = "__flow_producer__"

// FlowProducerOptions configures a FlowProducer.
type FlowProducerOptions struct {
	// Backend builds the datastore backend, for example
	// redisbackend.New(redisbackend.Options{Addr: "127.0.0.1:6379"}). It is
	// required. Every queue of a flow is reached through the backend it
	// builds, so the queues of a flow share its connections and its namespace
	// (the Redis key prefix or the PostgreSQL schema).
	Backend BackendFactory
}

// FlowJob is a node of a flow: a job and the children it waits for. A node
// with children is added in the waiting-children state and processed once
// all of them are, with their results available through
// [Job.ChildrenValues]. Children may belong to other queues.
type FlowJob struct {
	// Name is the job name handed to the processor.
	Name string
	// QueueName is the queue the job is added to.
	QueueName string
	// Data is the payload; it is marshalled to JSON.
	Data any
	// Opts are the job options. Opts.Parent is only honoured on the root of
	// a flow, to add the whole flow under an existing job; the other nodes
	// are children of their parent node. Deduplication is only allowed on a
	// root without children nor parent.
	Opts *JobOptions
	// Children are the jobs this job waits for.
	Children []FlowJob
}

// FlowOpts tunes [FlowProducer.Add].
type FlowOpts struct {
	// QueuesOptions holds options for the nodes of a queue, by queue name.
	QueuesOptions map[string]FlowQueueOptions
}

// FlowQueueOptions are applied to every node of a flow that belongs to one
// queue.
type FlowQueueOptions struct {
	// DefaultJobOptions are merged into the options of the queue's nodes, as
	// QueueOptions.DefaultJobOptions are into the jobs of a Queue.
	DefaultJobOptions *JobOptions
}

// JobNode is a job of a flow with its children.
type JobNode struct {
	Job      *Job
	Children []*JobNode
}

// FlowGetOptions selects the flow returned by [FlowProducer.GetFlow].
type FlowGetOptions struct {
	// ID is the id of the root job.
	ID string
	// QueueName is the queue of the root job.
	QueueName string
	// Depth is how many levels of the tree are returned, the root included.
	// Defaults to 10.
	Depth int
	// MaxChildren is how many children of each status (processed,
	// unprocessed, failed, ignored) are returned per job. Defaults to 20. On
	// Redis it is a hint, like the COUNT of HSCAN: the children of a small
	// group are all returned.
	MaxChildren int64
}

// FlowProducer adds flows: trees of jobs, possibly spanning several queues,
// in which a parent is processed only once its children are, as Node's
// FlowProducer does.
//
// A FlowProducer is safe for concurrent use.
type FlowProducer struct {
	backend Backend

	mu     sync.Mutex
	queues map[string]Backend
	closed bool
}

// NewFlowProducer creates a flow producer.
func NewFlowProducer(opts *FlowProducerOptions) (*FlowProducer, error) {
	if opts == nil {
		opts = &FlowProducerOptions{}
	}
	backend, err := resolveBackend(opts.Backend, flowProducerBackendName, BackendOptions{})
	if err != nil {
		return nil, err
	}
	return &FlowProducer{backend: backend, queues: make(map[string]Backend)}, nil
}

// Close releases the connections of the flow producer. The jobs it returned
// can no longer reach the datastore afterwards.
func (fp *FlowProducer) Close() error {
	fp.mu.Lock()
	if fp.closed {
		fp.mu.Unlock()
		return nil
	}
	fp.closed = true
	queues := fp.queues
	fp.queues = nil
	fp.mu.Unlock()

	var errs []error
	for _, b := range queues {
		errs = append(errs, b.Close())
	}
	errs = append(errs, fp.backend.Close())
	return errors.Join(errs...)
}

// queueBackend returns the backend of the queue called name, sharing the
// flow producer's connections.
func (fp *FlowProducer) queueBackend(name string) (Backend, error) {
	fp.mu.Lock()
	defer fp.mu.Unlock()
	if fp.closed {
		return nil, ErrFlowProducerClosed
	}
	if b, ok := fp.queues[name]; ok {
		return b, nil
	}
	b, err := fp.backend.ForQueue(name)
	if err != nil {
		return nil, err
	}
	fp.queues[name] = b
	return b, nil
}

// Add adds a flow and returns its jobs. Children are processed before their
// parents; a parent sees their results with [Job.ChildrenValues].
//
// The whole tree is sent in one datastore operation (a Redis transaction, a
// database transaction on PostgreSQL). When the datastore rejects one of its
// jobs, for example because the parent of the root does not exist
// ([ErrParentJobNotExist]: then no job is added) or because a child with a
// custom id already belongs to another parent
// ([ErrParentJobCannotBeReplaced]), Add returns an error. PostgreSQL then
// rolls the whole tree back; on Redis, as in Node, the jobs the datastore
// accepted are kept.
func (fp *FlowProducer) Add(ctx context.Context, flow FlowJob, opts *FlowOpts) (*JobNode, error) {
	var queuesOpts map[string]FlowQueueOptions
	if opts != nil {
		queuesOpts = opts.QueuesOptions
	}
	trees, err := fp.addFlows(ctx, []FlowJob{flow}, queuesOpts)
	if err != nil {
		return nil, err
	}
	return trees[0], nil
}

// AddBulk adds several flows in one datastore operation and returns their
// jobs, in order. Errors are reported as in [FlowProducer.Add]: when the
// datastore rejects a job, AddBulk returns an error; PostgreSQL then adds no
// job of any of the flows, while Redis keeps the jobs it accepted.
func (fp *FlowProducer) AddBulk(ctx context.Context, flows []FlowJob) ([]*JobNode, error) {
	if len(flows) == 0 {
		return nil, nil
	}
	return fp.addFlows(ctx, flows, nil)
}

// flowBuild collects the entries of the flows being added, with the job each
// of them becomes.
type flowBuild struct {
	entries    []FlowEntry
	jobs       []*Job
	queuesOpts map[string]FlowQueueOptions
}

func (fp *FlowProducer) addFlows(ctx context.Context, flows []FlowJob, queuesOpts map[string]FlowQueueOptions) ([]*JobNode, error) {
	if err := validateFlowJobs(flows); err != nil {
		return nil, err
	}
	build := &flowBuild{queuesOpts: queuesOpts}
	trees := make([]*JobNode, len(flows))
	for i, flow := range flows {
		var parent *ParentOptions
		if flow.Opts != nil {
			parent = flow.Opts.Parent
		}
		tree, err := fp.addNode(build, flow, parent)
		if err != nil {
			return nil, err
		}
		trees[i] = tree
	}

	ids, err := fp.backend.AddFlow(ctx, build.entries)
	if err != nil {
		return nil, err
	}
	if len(ids) != len(build.entries) {
		return nil, configError("backend returned %d job ids for %d flow jobs", len(ids), len(build.entries))
	}
	// A root without children may have been deduplicated into an existing
	// job; every other id is the one that was sent.
	for i, id := range ids {
		build.jobs[i].ID = id
	}
	return trees, nil
}

// addNode collects the entry of node, a child of parent (nil for a root
// without a parent), followed by the entries of its subtree.
func (fp *FlowProducer) addNode(build *flowBuild, node FlowJob, parent *ParentOptions) (*JobNode, error) {
	if err := validateQueueName(node.QueueName); err != nil {
		return nil, err
	}
	backend, err := fp.queueBackend(node.QueueName)
	if err != nil {
		return nil, err
	}

	var opts JobOptions
	if node.Opts != nil {
		opts = *node.Opts
	}
	opts.Parent = parent

	// A node is validated and built exactly as Queue.Add would for its
	// queue, with the flow's default options for that queue.
	q := &Queue{backend: backend, defaultJobOptions: build.queuesOpts[node.QueueName].DefaultJobOptions}
	nj, err := q.prepareJob(JobSpec{Name: node.Name, Data: node.Data, Opts: &opts})
	if err != nil {
		return nil, err
	}
	jobID := nj.Opts.JobID
	if jobID == "" {
		jobID = randomUUID()
	}
	job, err := q.newAddedJob(jobID, nj)
	if err != nil {
		return nil, err
	}

	hasChildren := len(node.Children) > 0
	build.entries = append(build.entries, FlowEntry{
		QueueName:       node.QueueName,
		JobID:           jobID,
		Job:             nj,
		WaitingChildren: hasChildren,
	})
	build.jobs = append(build.jobs, job)

	tree := &JobNode{Job: job}
	if !hasChildren {
		return tree, nil
	}
	childParent := &ParentOptions{ID: jobID, Queue: backend.QualifiedName()}
	tree.Children = make([]*JobNode, len(node.Children))
	for i, child := range node.Children {
		if tree.Children[i], err = fp.addNode(build, child, childParent); err != nil {
			return nil, err
		}
	}
	return tree, nil
}

// validateFlowJobs rejects deduplication on nodes with children, as Node
// does: a parent's id must be known before it is stored, so that its
// children can reference it. Deduplication on a node with a parent is
// rejected when the node is prepared, as for any job with a parent.
func validateFlowJobs(nodes []FlowJob) error {
	for _, node := range nodes {
		if len(node.Children) == 0 {
			continue
		}
		if node.Opts != nil && node.Opts.Deduplication != nil {
			return configError("deduplication options cannot be used on flow nodes with children")
		}
		if err := validateFlowJobs(node.Children); err != nil {
			return err
		}
	}
	return nil
}

// GetFlow returns the tree of jobs rooted at a job: the job and, level by
// level, the children it has in any status. It returns nil when the job does
// not exist. Children that no longer exist are left out.
func (fp *FlowProducer) GetFlow(ctx context.Context, opts FlowGetOptions) (*JobNode, error) {
	if err := validateQueueName(opts.QueueName); err != nil {
		return nil, err
	}
	depth := opts.Depth
	if depth <= 0 {
		depth = 10
	}
	maxChildren := opts.MaxChildren
	if maxChildren <= 0 {
		maxChildren = 20
	}
	backend, err := fp.queueBackend(opts.QueueName)
	if err != nil {
		return nil, err
	}
	return fp.getNode(ctx, backend, opts.ID, depth, maxChildren)
}

func (fp *FlowProducer) getNode(ctx context.Context, backend Backend, jobID string, depth int, maxChildren int64) (*JobNode, error) {
	rec, err := backend.GetJob(ctx, jobID)
	if err != nil || rec == nil {
		return nil, err
	}
	node := &JobNode{Job: newJob(backend, rec)}
	if depth <= 1 {
		return node, nil
	}

	page := &DependencyPage{Count: maxChildren}
	deps, err := backend.GetDependencies(ctx, jobID, &DependenciesOptions{
		Processed: page, Unprocessed: page, Failed: page, Ignored: page,
	})
	if err != nil {
		return nil, err
	}
	keys := slices.Sorted(maps.Keys(deps.Processed))
	keys = append(keys, deps.Unprocessed...)
	keys = append(keys, deps.Failed...)
	keys = append(keys, slices.Sorted(maps.Keys(deps.Ignored))...)

	for _, key := range keys {
		// Dependency keys are `{QualifiedName}:{id}`, as parent keys are.
		i := strings.LastIndex(key, ":")
		if i <= 0 {
			continue
		}
		childBackend, err := fp.queueBackend(key[:i])
		if err != nil {
			return nil, err
		}
		child, err := fp.getNode(ctx, childBackend, key[i+1:], depth-1, maxChildren)
		if err != nil {
			return nil, err
		}
		if child != nil {
			node.Children = append(node.Children, child)
		}
	}
	return node, nil
}

// randomUUID returns a random (version 4) UUID, the form Node's
// FlowProducer gives the ids of flow jobs.
func randomUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand never fails on the platforms Go supports.
		panic(err)
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
