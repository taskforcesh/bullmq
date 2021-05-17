import uuid = require('uuid');

import { Redis, Pipeline } from 'ioredis';

import { EventEmitter } from 'events';
import { QueueBaseOptions } from '../interfaces';
import { RedisConnection } from './redis-connection';
import { KeysMap, QueueKeys } from './queue-keys';
import { FlowJob } from '../interfaces/flow-job';
import { Job } from './job';

export interface JobNode {
  job: Job;
  children?: JobNode[];
}

/**
 * This class allows to add jobs into one or several queues
 * with dependencies between them in such a way that it is possible
 * to build complex flows.
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
   * A flow is a tree-like structure of jobs that depend on each other.
   * Whenever the children of a given parent are completed, the parent
   * will be processed, being able to access the children's result data.
   *
   * All Jobs can be in different queues, either children or parents,
   * however this call would be atomic, either it fails and no jobs will
   * be added to the queues, or it succeeds and all jobs will be added.
   *
   * @param flow An object with a tree-like structure where children jobs
   * will be processed before their parents.
   */
  async add(flow: FlowJob) {
    if (this.closing) {
      return;
    }
    const client = await this.connection.client;
    const multi = client.multi();

    const jobsTree = this.addNode(multi, flow);

    const result = await multi.exec();

    const updateJobIds = (
      jobsTree: JobNode,
      result: [Error, string][],
      index: number,
    ) => {
      // TODO: Can we safely ignore result errors? how could they happen in the
      // first place?
      jobsTree.job.id = result[index][1];
      const children = jobsTree.children;
      if (children) {
        for (let i = 0; i < children.length; i++) {
          updateJobIds(children[i], result, index + i + 1);
        }
      }
    };

    updateJobIds(jobsTree, result, 0);

    return jobsTree;
  }

  /**
   * Add a node (job) of a flow to the queue. This method will recursively
   * add all its children as well. Note that a given job can potentially be
   * a parent and a child job at the same time depending on where it is located
   * in the tree hierarchy.
   *
   * @param multi ioredis pipeline
   * @param node the node representing a job to be added to some queue
   * @param parent Parent data sent to children to create the "links" to their parent
   * @returns
   */
  private addNode(
    multi: Pipeline,
    node: FlowJob,
    parent?: {
      parentOpts: {
        id: string;
        queue: string;
      };
      parentDependenciesKey: string;
    },
  ): JobNode {
    const queue = this.queueFromNode(node, new QueueKeys(node.prefix));

    const jobId = node.opts?.jobId || uuid.v4();
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

      const children = this.addChildren(multi, node.children, {
        parentOpts: {
          id: parentId,
          queue: queueKeysParent.getPrefixedQueueName(node.queueName),
        },
        parentDependenciesKey,
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

  private addChildren(
    multi: Pipeline,
    nodes: FlowJob[],
    parent: {
      parentOpts: {
        id: string;
        queue: string;
      };
      parentDependenciesKey: string;
    },
  ) {
    return nodes.map(node => this.addNode(multi, node, parent));
  }

  /**
   * Helper factory method that creates a queue-like object
   * required to create jobs in any queue.
   *
   * @param node
   * @param queueKeys
   * @returns
   */
  private queueFromNode(node: FlowJob, queueKeys: QueueKeys) {
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

export function getParentKey(opts: { id: string; queue: string }) {
  if (opts) {
    return `${opts.queue}:${opts.id}`;
  }
}
