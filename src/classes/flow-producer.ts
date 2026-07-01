import { EventEmitter } from 'events';
import {
  BackendFactory,
  FlowJob,
  FlowProducerOptions,
  FlowQueuesOpts,
  FlowOpts,
  IoredisListener,
  IQueueBackend,
  JobJson,
  ParentKeyOpts,
  ParentOptions,
  QueueBaseOptions,
  Tracer,
  ContextManager,
} from '../interfaces';
import { getParentKey, randomUUID, trace } from '../utils';
import { getDefaultBackendFactory } from '../utils/create-backend';
import { Job } from './job';
import { RedisQueueBackend } from './redis-queue-backend';
import { KeysMap } from './queue-keys';
import { ErrorCode, SpanKind, TelemetryAttributes } from '../enums';

/**
 * A single job insert collected while walking a flow tree, ready to be handed
 * to the backend's atomic {@link IQueueBackend.addFlow} operation.
 */
export interface FlowJobEntry {
  jobData: JobJson;
  jobId: string;
  parentKeyOpts: ParentKeyOpts;
  prefix: string;
  queueName: string;
}

export interface AddNodeOpts {
  entries: FlowJobEntry[];
  node: FlowJob;
  parent?: {
    parentOpts: ParentOptions;
    parentDependenciesKey: string;
  };
  /**
   * Queues options that will be applied in each node depending on queue name presence.
   */
  queuesOpts?: FlowQueuesOpts;
}

export interface AddChildrenOpts {
  entries: FlowJobEntry[];
  nodes: FlowJob[];
  parent: {
    parentOpts: ParentOptions;
    parentDependenciesKey: string;
  };
  queuesOpts?: FlowQueuesOpts;
}

export interface NodeOpts {
  /**
   * Root job queue name.
   */
  queueName: string;
  /**
   * Prefix included in job key.
   */
  prefix?: string;
  /**
   * Root job id.
   */
  id: string;
  /**
   * Maximum depth or levels to visit in the tree.
   */
  depth?: number;
  /**
   * Maximum quantity of children per type (processed, unprocessed).
   */
  maxChildren?: number;
}

export interface JobNode {
  job: Job;
  children?: JobNode[];
}

export interface FlowProducerListener extends IoredisListener {
  /**
   * Listen to 'error' event.
   *
   * This event is triggered when an error is throw.
   */
  error: (failedReason: Error) => void;
}

/**
 * This class allows to add jobs with dependencies between them in such
 * a way that it is possible to build complex flows.
 * Note: A flow is a tree-like structure of jobs that depend on each other.
 * Whenever the children of a given parent are completed, the parent
 * will be processed, being able to access the children's result data.
 * All Jobs can be in different queues, either children or parents,
 */
export class FlowProducer<
  B extends IQueueBackend = RedisQueueBackend,
> extends EventEmitter {
  toKey: (name: string, type: string) => string;
  keys: KeysMap;
  closing: Promise<void> | undefined;

  protected backend: B;
  protected telemetry: {
    tracer: Tracer | undefined;
    contextManager: ContextManager | undefined;
  };

  constructor(
    public opts: FlowProducerOptions = { connection: {} },
    backendFactory: BackendFactory<B> = getDefaultBackendFactory<B>(),
  ) {
    super();

    this.opts = {
      ...opts,
    };

    // The flow producer is not bound to a single queue: each flow entry carries
    // its own queue identity, so the backend is created with an empty name.
    this.backend = backendFactory('', this.opts);

    this.backend.on('error', (error: Error) => this.emit('error', error));
    this.backend.on('close', () => {
      if (!this.closing) {
        this.emit('ioredis:close');
      }
    });

    if (opts?.telemetry) {
      this.telemetry = opts.telemetry;
    }
  }

  emit<U extends keyof FlowProducerListener>(
    event: U,
    ...args: Parameters<FlowProducerListener[U]>
  ): boolean {
    return super.emit(event, ...args);
  }

  off<U extends keyof FlowProducerListener>(
    eventName: U,
    listener: FlowProducerListener[U],
  ): this {
    super.off(eventName, listener);
    return this;
  }

  on<U extends keyof FlowProducerListener>(
    event: U,
    listener: FlowProducerListener[U],
  ): this {
    super.on(event, listener);
    return this;
  }

  once<U extends keyof FlowProducerListener>(
    event: U,
    listener: FlowProducerListener[U],
  ): this {
    super.once(event, listener);
    return this;
  }

  /**
   * Helper to easily extend Job class calls.
   */
  protected get Job(): typeof Job {
    return Job;
  }

  waitUntilReady(): Promise<void> {
    return this.backend.waitUntilReady();
  }

  /**
   * Returns the datastore backend that powers this flow producer.
   *
   * The backend owns its connection and exposes every datastore-agnostic
   * operation through {@link IQueueBackend}. Datastore-specific escape hatches
   * (e.g. the raw Redis client) live on the concrete backend implementation,
   * and are exposed here when the flow producer is parameterized on that
   * concrete backend type (the default is the Redis backend).
   */
  getBackend(): B {
    return this.backend;
  }

  /**
   * Adds a flow.
   *
   * This call would be atomic, either it fails and no jobs will
   * be added to the queues, or it succeeds and all jobs will be added.
   *
   * @param flow - an object with a tree-like structure where children jobs
   * will be processed before their parents.
   * @param opts - options that will be applied to the flow object.
   */
  async add(flow: FlowJob, opts?: FlowOpts): Promise<JobNode> {
    if (this.closing) {
      return;
    }

    // Ensure the backend (and thus the connection) is ready before building
    // the per-node queue contexts used to create jobs.
    await this.backend.waitUntilReady();

    const parentOpts = flow?.opts?.parent;
    const parentKey = getParentKey(parentOpts);
    const parentDependenciesKey = parentKey
      ? `${parentKey}:dependencies`
      : undefined;

    return trace<Promise<JobNode>>(
      this.telemetry,
      SpanKind.PRODUCER,
      flow.queueName,
      'addFlow',
      flow.queueName,
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.FlowName]: flow.name,
        });

        const entries: FlowJobEntry[] = [];
        const jobsTree = await this.addNode({
          entries,
          node: flow,
          queuesOpts: opts?.queuesOptions,
          parent: {
            parentOpts,
            parentDependenciesKey,
          },
        });

        const results = await this.backend.addFlow(entries);
        const [result] = results || [];
        if (result) {
          const [err, jobId] = result;
          if (err) {
            throw err;
          }
          if (typeof jobId === 'number' && jobId < 0) {
            throw this.toFlowError(jobId, parentKey);
          }
          if (typeof jobId === 'string') {
            jobsTree.job.id = jobId;
          }
        }

        return jobsTree;
      },
    );
  }

  /**
   * Get a flow.
   *
   * @param opts - an object with options for getting a JobNode.
   */
  async getFlow(opts: NodeOpts): Promise<JobNode> {
    if (this.closing) {
      return;
    }
    await this.backend.waitUntilReady();

    const updatedOpts = Object.assign(
      {
        depth: 10,
        maxChildren: 20,
        prefix: this.opts.prefix,
      },
      opts,
    );
    const jobsTree = this.getNode(updatedOpts);

    return jobsTree;
  }

  /**
   * Adds multiple flows.
   *
   * A flow is a tree-like structure of jobs that depend on each other.
   * Whenever the children of a given parent are completed, the parent
   * will be processed, being able to access the children's result data.
   *
   * All Jobs can be in different queues, either children or parents,
   * however this call would be atomic, either it fails and no jobs will
   * be added to the queues, or it succeeds and all jobs will be added.
   *
   * @param flows - an array of objects with a tree-like structure where children jobs
   * will be processed before their parents.
   */
  async addBulk(flows: FlowJob[]): Promise<JobNode[]> {
    if (this.closing) {
      return;
    }

    // Ensure the backend (and thus the connection) is ready before building
    // the per-node queue contexts used to create jobs.
    await this.backend.waitUntilReady();

    return trace<Promise<JobNode[]>>(
      this.telemetry,
      SpanKind.PRODUCER,
      '',
      'addBulkFlows',
      '',
      async span => {
        span?.setAttributes({
          [TelemetryAttributes.BulkCount]: flows.length,
          [TelemetryAttributes.BulkNames]: flows
            .map(flow => flow.name)
            .join(','),
        });

        const entries: FlowJobEntry[] = [];
        const jobsTrees = await this.addNodes(entries, flows);

        const results = await this.backend.addFlow(entries);
        for (let index = 0; index < jobsTrees.length; ++index) {
          const result = results?.[index];
          if (!result) {
            continue;
          }

          const [err, jobId] = result;
          if (!err && typeof jobId === 'string') {
            jobsTrees[index].job.id = jobId;
          }
        }

        return jobsTrees;
      },
    );
  }

  /**
   * Add a node (job) of a flow to the queue. This method will recursively
   * add all its children as well. Note that a given job can potentially be
   * a parent and a child job at the same time depending on where it is located
   * in the tree hierarchy.
   *
   * @param multi - IRedisTransaction
   * @param node - the node representing a job to be added to some queue
   * @param parent - parent data sent to children to create the "links" to their parent
   * @returns
   */
  protected async addNode({
    entries,
    node,
    parent,
    queuesOpts,
  }: AddNodeOpts): Promise<JobNode> {
    const prefix = node.prefix || this.opts.prefix;
    const queue = this.queueFromNode(node, prefix);
    const queueOpts = queuesOpts && queuesOpts[node.queueName];

    const jobsOpts = queueOpts?.defaultJobOptions ?? {};
    const jobId = node.opts?.jobId || randomUUID();

    return trace<Promise<JobNode>>(
      this.telemetry,
      SpanKind.PRODUCER,
      node.queueName,
      'addNode',
      node.queueName,
      async (span, srcPropagationMetadata) => {
        span?.setAttributes({
          [TelemetryAttributes.JobName]: node.name,
          [TelemetryAttributes.JobId]: jobId,
        });
        const opts = node.opts;
        let telemetry = opts?.telemetry;

        if (srcPropagationMetadata && opts) {
          const omitContext = opts.telemetry?.omitContext;
          const telemetryMetadata =
            opts.telemetry?.metadata ||
            (!omitContext && srcPropagationMetadata);

          if (telemetryMetadata || omitContext) {
            telemetry = {
              metadata: telemetryMetadata,
              omitContext,
            };
          }
        }

        const job = new this.Job(
          queue,
          node.name,
          node.data,
          {
            ...jobsOpts,
            ...opts,
            parent: parent?.parentOpts,
            telemetry,
          },
          jobId,
        );

        const parentKey = getParentKey(parent?.parentOpts);

        if (node.children && node.children.length > 0) {
          // Create the parent job, it will be a job in status "waiting-children".
          const parentId = jobId;

          await this.collectFlowEntry(entries, job, {
            parentDependenciesKey: parent?.parentDependenciesKey,
            addToWaitingChildren: true,
            parentKey,
          });

          // Queue identity is owned by the backend (the `queue` object above is
          // bound to this node's queue via the backend's `forQueue`).
          const parentDependenciesKey = `${queue.toKey(parentId)}:dependencies`;

          const children = await this.addChildren({
            entries,
            nodes: node.children,
            parent: {
              parentOpts: {
                id: parentId,
                queue: queue.qualifiedName,
              },
              parentDependenciesKey,
            },
            queuesOpts,
          });

          return { job, children };
        } else {
          await this.collectFlowEntry(entries, job, {
            parentDependenciesKey: parent?.parentDependenciesKey,
            parentKey,
          });

          return { job };
        }
      },
    );
  }

  /**
   * Adds nodes (jobs) of multiple flows to the queue. This method will recursively
   * add all its children as well. Note that a given job can potentially be
   * a parent and a child job at the same time depending on where it is located
   * in the tree hierarchy.
   *
   * @param multi - IRedisTransaction
   * @param nodes - the nodes representing jobs to be added to some queue
   * @returns
   */
  /**
   * Collects a single job insert for a flow, preserving the same await point
   * as the previous transaction-based insert so that the relative order of
   * entries (in particular, roots before their descendants) is unchanged.
   */
  private async collectFlowEntry(
    entries: FlowJobEntry[],
    job: Job,
    parentOpts: ParentKeyOpts,
  ): Promise<void> {
    entries.push(job.toFlowEntry(parentOpts));
  }

  protected addNodes(
    entries: FlowJobEntry[],
    nodes: FlowJob[],
  ): Promise<JobNode[]> {
    return Promise.all(
      nodes.map(node => {
        const parentOpts = node?.opts?.parent;
        const parentKey = getParentKey(parentOpts);
        const parentDependenciesKey = parentKey
          ? `${parentKey}:dependencies`
          : undefined;

        return this.addNode({
          entries,
          node,
          parent: {
            parentOpts,
            parentDependenciesKey,
          },
        });
      }),
    );
  }

  private async getNode(node: NodeOpts): Promise<JobNode> {
    const queue = this.queueFromNode(node, node.prefix);

    const job = await this.Job.fromId(queue, node.id);

    if (job) {
      const {
        processed = {},
        unprocessed = [],
        failed = [],
        ignored = {},
      } = await job.getDependencies({
        failed: {
          count: node.maxChildren,
        },
        processed: {
          count: node.maxChildren,
        },
        unprocessed: {
          count: node.maxChildren,
        },
        ignored: {
          count: node.maxChildren,
        },
      });
      const processedKeys = Object.keys(processed);
      const ignoredKeys = Object.keys(ignored);

      const childrenCount =
        processedKeys.length +
        unprocessed.length +
        ignoredKeys.length +
        failed.length;
      const newDepth = node.depth - 1;
      if (childrenCount > 0 && newDepth) {
        const children = await this.getChildren(
          [...processedKeys, ...unprocessed, ...failed, ...ignoredKeys],
          newDepth,
          node.maxChildren,
        );

        return { job, children };
      } else {
        return { job };
      }
    }
  }

  private addChildren({ entries, nodes, parent, queuesOpts }: AddChildrenOpts) {
    return Promise.all(
      nodes.map(node => this.addNode({ entries, node, parent, queuesOpts })),
    );
  }

  private getChildren(
    childrenKeys: string[],
    depth: number,
    maxChildren: number,
  ) {
    const getChild = (key: string) => {
      const [prefix, queueName, id] = key.split(':');

      return this.getNode({
        id,
        queueName,
        prefix,
        depth,
        maxChildren,
      });
    };

    return Promise.all([...childrenKeys.map(getChild)]);
  }

  /**
   * Helper factory method that creates a queue-like object
   * required to create jobs in any queue.
   *
   * @param node - The flow node containing the queue name and other job options.
   * @param prefix - The key prefix for the queue (honored by the Redis backend only).
   * @returns A queue-like object with the keys, identity and backend needed to create jobs.
   */
  private queueFromNode(
    node: Omit<NodeOpts, 'id' | 'depth' | 'maxChildren'>,
    prefix: string,
  ) {
    // Queue identity and key building are owned by the backend (the Redis
    // backend encodes the key `prefix`; other backends format their own
    // identity). The flow's own backend is queue-agnostic, so we ask it for a
    // sibling bound to this node's queue.
    const backend = this.backend.forQueue(node.queueName, prefix);
    return {
      name: node.queueName,
      keys: backend.keys,
      toKey: (type: string) => backend.toKey(type),
      opts: { prefix, connection: {} },
      qualifiedName: backend.qualifiedName,
      closing: this.closing,
      backend,
      waitUntilReady: async (): Promise<void> => {
        await this.backend.waitUntilReady();
      },
      removeListener: this.removeListener.bind(this) as any,
      emit: this.emit.bind(this) as any,
      on: this.on.bind(this) as any,
      trace: async (): Promise<any> => {},
    };
  }

  /**
   * Translates numeric addJob Lua error codes returned by root flow exec.
   *
   * @param code - Numeric error code returned from Redis.
   * @param parentKey - Parent key for contextual error messages.
   */
  private toFlowError(code: number, parentKey?: string): Error {
    let error: Error;
    switch (code) {
      case ErrorCode.ParentJobNotExist:
        error = new Error(`Missing key for parent job ${parentKey}. addJob`);
        break;
      case ErrorCode.ParentJobCannotBeReplaced:
        error = new Error(
          `The parent job ${parentKey} cannot be replaced. addJob`,
        );
        break;
      default:
        error = new Error(`Unknown code ${code} error for addJob`);
    }
    (error as any).code = code;
    return error;
  }

  /**
   *
   * Closes the connection and returns a promise that resolves when the connection is closed.
   */
  async close(): Promise<void> {
    if (!this.closing) {
      this.closing = this.backend.close();
    }
    await this.closing;
  }

  /**
   *
   * Force disconnects a connection.
   */
  disconnect(): Promise<void> {
    return this.backend.disconnect();
  }
}
