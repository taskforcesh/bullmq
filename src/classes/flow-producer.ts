import { EventEmitter } from 'events';
import { Redis, Pipeline } from 'ioredis';
import { v4 } from 'uuid';
import { QueueBaseOptions } from '../interfaces/queue-options';
import { FlowJob, FlowQueuesOpts, FlowOpts } from '../interfaces/flow-job';
import { getParentKey, jobIdForGroup } from '../utils';
import { Job } from './job';
import { KeysMap, QueueKeys } from './queue-keys';
import { RedisClient, RedisConnection } from './redis-connection';

export interface AddNodeOpts {
  multi: Pipeline;
  node: FlowJob;
  parent?: {
    parentOpts: {
      id: string;
      queue: string;
    };
    parentDependenciesKey: string;
  };
  /**
   * Queues options that will be applied in each node depending on queue name presence.
   */
  queuesOpts?: FlowQueuesOpts;
}

export interface AddChildrenOpts {
  multi: Pipeline;
  nodes: FlowJob[];
  parent: {
    parentOpts: {
      id: string;
      queue: string;
    };
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

/**
 * This class allows to add jobs with dependencies between them in such
 * a way that it is possible to build complex flows.
 * Note: A flow is a tree-like structure of jobs that depend on each other.
 * Whenever the children of a given parent are completed, the parent
 * will be processed, being able to access the children's result data.
 * All Jobs can be in different queues, either children or parents,
 */
export class FlowProducer extends EventEmitter {
  toKey: (name: string, type: string) => string;
  keys: KeysMap;
  closing: Promise<void>;
  queueKeys: QueueKeys;

  protected connection: RedisConnection;

  constructor(public opts: QueueBaseOptions = {}) {
    super();

    this.opts = {
      prefix: 'bull',
      ...opts,
    };

    this.connection = new RedisConnection(opts.connection);
    this.connection.on('error', this.emit.bind(this, 'error'));

    this.queueKeys = new QueueKeys(opts.prefix);
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
    const client = await this.connection.client;
    const multi = client.multi();

    const jobsTree = this.addNode({
      multi,
      node: flow,
      queuesOpts: opts?.queuesOptions,
    });

    await multi.exec();

    return jobsTree;
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
    const client = await this.connection.client;

    const updatedOpts = Object.assign(
      {
        depth: 10,
        maxChildren: 20,
      },
      opts,
    );
    const jobsTree = this.getNode(client, updatedOpts);

    return jobsTree;
  }

  get client(): Promise<RedisClient> {
    return this.connection.client;
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
    const client = await this.connection.client;
    const multi = client.multi();

    const jobsTrees = this.addNodes(multi, flows);

    await multi.exec();

    return jobsTrees;
  }

  /**
   * Add a node (job) of a flow to the queue. This method will recursively
   * add all its children as well. Note that a given job can potentially be
   * a parent and a child job at the same time depending on where it is located
   * in the tree hierarchy.
   *
   * @param multi - ioredis pipeline
   * @param node - the node representing a job to be added to some queue
   * @param parent - parent data sent to children to create the "links" to their parent
   * @returns
   */
  private addNode({ multi, node, parent, queuesOpts }: AddNodeOpts): JobNode {
    const queue = this.queueFromNode(node, new QueueKeys(node.prefix));
    const queueOpts = queuesOpts && queuesOpts[node.queueName];

    const jobId = jobIdForGroup(node.opts, node.data, queueOpts) || v4();

    const job = new Job(
      queue,
      node.name,
      node.data,
      {
        ...node.opts,
        parent: parent?.parentOpts,
      },
      jobId,
    );

    const parentKey = getParentKey(parent?.parentOpts);

    if (node.children && node.children.length > 0) {
      // Create parent job, will be a job in status "waiting-children".
      const parentId = jobId;
      const queueKeysParent = new QueueKeys(node.prefix);
      const waitChildrenKey = queueKeysParent.toKey(
        node.queueName,
        'waiting-children',
      );

      job.addJob(<Redis>(multi as unknown), {
        parentDependenciesKey: parent?.parentDependenciesKey,
        waitChildrenKey,
        parentKey,
      });

      const parentDependenciesKey = `${queueKeysParent.toKey(
        node.queueName,
        parentId,
      )}:dependencies`;

      const children = this.addChildren({
        multi,
        nodes: node.children,
        parent: {
          parentOpts: {
            id: parentId,
            queue: queueKeysParent.getPrefixedQueueName(node.queueName),
          },
          parentDependenciesKey,
        },
        queuesOpts,
      });

      return { job, children };
    } else {
      job.addJob(<Redis>(multi as unknown), {
        parentDependenciesKey: parent?.parentDependenciesKey,
        parentKey,
      });

      return { job };
    }
  }

  /**
   * Adds nodes (jobs) of multiple flows to the queue. This method will recursively
   * add all its children as well. Note that a given job can potentially be
   * a parent and a child job at the same time depending on where it is located
   * in the tree hierarchy.
   *
   * @param multi - ioredis pipeline
   * @param nodes - the nodes representing jobs to be added to some queue
   * @returns
   */
  private addNodes(multi: Pipeline, nodes: FlowJob[]): JobNode[] {
    return nodes.map(node => this.addNode({ multi, node }));
  }

  private async getNode(client: RedisClient, node: NodeOpts): Promise<JobNode> {
    const queue = this.queueFromNode(node, new QueueKeys(node.prefix));

    const job = await Job.fromId(queue, node.id);

    if (job) {
      const { processed = {}, unprocessed = [] } = await job.getDependencies({
        processed: {
          count: node.maxChildren,
        },
        unprocessed: {
          count: node.maxChildren,
        },
      });
      const processedKeys = Object.keys(processed);

      const childrenCount = processedKeys.length + unprocessed.length;
      const newDepth = node.depth - 1;
      if (childrenCount > 0 && newDepth) {
        const children = await this.getChildren(
          client,
          [...processedKeys, ...unprocessed],
          newDepth,
          node.maxChildren,
        );

        return { job, children };
      } else {
        return { job };
      }
    }
  }

  private addChildren({ multi, nodes, parent, queuesOpts }: AddChildrenOpts) {
    return nodes.map(node => this.addNode({ multi, node, parent, queuesOpts }));
  }

  private getChildren(
    client: RedisClient,
    childrenKeys: string[],
    depth: number,
    maxChildren: number,
  ) {
    const getChild = (key: string) => {
      const [prefix, queueName, id] = key.split(':');

      return this.getNode(client, {
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
   * @param node -
   * @param queueKeys -
   * @returns
   */
  private queueFromNode(
    node: Omit<NodeOpts, 'id' | 'depth' | 'maxChildren'>,
    queueKeys: QueueKeys,
  ) {
    return {
      client: this.connection.client,
      name: node.queueName,
      keys: queueKeys.getKeys(node.queueName),
      toKey: (type: string) => queueKeys.toKey(node.queueName, type),
      opts: {},
      closing: this.closing,
      waitUntilReady: async () => this.connection.client,
      removeListener: this.removeListener.bind(this) as any,
      emit: this.emit.bind(this) as any,
      on: this.on.bind(this) as any,
      redisVersion: this.connection.redisVersion,
    };
  }

  close() {
    if (!this.closing) {
      this.closing = this.connection.close();
    }
    return this.closing;
  }

  disconnect() {
    return this.connection.disconnect();
  }
}
