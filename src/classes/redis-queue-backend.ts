/**
 * Includes all the scripts needed by the queue and jobs.
 */

'use strict';
import { EventEmitter } from 'events';
import { Packr } from 'msgpackr';

const packer = new Packr({
  useRecords: false,
  encodeUndefinedAsNil: true,
});

const pack = packer.pack;

import {
  BaseJobOptions,
  DependenciesOpts,
  IQueueBackend,
  JobJson,
  KeyPrefixOptions,
  MinimalJob,
  MoveToWaitingChildrenOpts,
  ParentKeyOpts,
  RedisClient,
  WorkerOptions,
  MoveToDelayedOpts,
  RepeatableOptions,
  RetryJobOpts,
  RetryOptions,
  ScriptQueueContext,
  StreamReadRaw,
} from '../interfaces';
import {
  CompressableJobOptions,
  DeduplicationOptions,
  JobsOptions,
  JobState,
  JobType,
  FinishedStatus,
  FinishedPropValAttribute,
  KeepJobs,
  JobProgress,
} from '../types';
import { ErrorCode } from '../enums';
import {
  array2obj,
  clientCommandMessageReg,
  errorObject,
  getParentKey,
  isEmpty,
  isRedisVersionLowerThan,
  objectToFlatArray,
  optsDecodeMap,
  optsEncodeMap,
  parseObjectValues,
  tryCatch,
} from '../utils';
import { IRedisTransaction } from '../interfaces';
import { QueueBaseOptions } from '../interfaces';
import { version as packageVersion } from '../version';
import { finishedErrors } from './finished-errors';
import { UnrecoverableError } from './errors';
import { KeysMap, QueueKeys } from './queue-keys';
import { RedisConnection } from './redis-connection';
export type JobData = [JobJson | number, string?];

export class RedisQueueBackend extends EventEmitter implements IQueueBackend {
  protected version = packageVersion;

  moveToFinishedKeys: (string | undefined)[];

  /**
   * Resolves once a close has been initiated. Owned by the backend (it owns the
   * underlying connection(s)).
   */
  closing: Promise<void> | undefined;

  /**
   * Internal Redis access context (client, version, keys, …). Built from the
   * owned connection(s); kept private to this adapter.
   */
  protected queue: ScriptQueueContext;

  /**
   * The resolved key prefix (defaults to `bull`). A Redis-specific concept used
   * to namespace this queue's keys, qualified name and client name.
   */
  protected readonly redisPrefix: string;

  constructor(
    public connection: RedisConnection,
    protected readonly name: string,
    keys: KeysMap,
    toKey: (type: string) => string,
    opts: QueueBaseOptions,
    public blockingConnection?: RedisConnection,
    protected ownsConnection = true,
  ) {
    super();

    this.redisPrefix = (opts as KeyPrefixOptions).prefix ?? 'bull';

    const self = this;
    this.queue = {
      keys,
      toKey,
      opts,
      get closing() {
        return self.closing;
      },
      get client() {
        return self.connection.client;
      },
      get blockingClient() {
        return self.blockingConnection?.client;
      },
      get redisVersion() {
        return self.connection.redisVersion;
      },
      get databaseType() {
        return self.connection.databaseType;
      },
    };

    this.moveToFinishedKeys = [
      keys.wait,
      keys.active,
      keys.prioritized,
      keys.events,
      keys.stalled,
      keys.limiter,
      keys.delayed,
      keys.paused,
      keys.meta,
      keys.pc,
      undefined,
      undefined,
      undefined,
      undefined,
    ];

    if (this.ownsConnection) {
      this.forwardConnectionEvents();
    }
  }

  /**
   * Returns a sibling backend bound to a different queue that shares this
   * backend's connection(s). Used by {@link FlowProducer} to operate on the
   * many queues that a flow may span over a single connection. The sibling
   * does not own the connection, so its `close`/`disconnect` are no-ops.
   */
  forQueue(queueName: string, prefix?: string): IQueueBackend {
    const resolvedPrefix = prefix ?? this.redisPrefix;
    const queueKeys = new QueueKeys(resolvedPrefix);
    return new RedisQueueBackend(
      this.connection,
      queueName,
      queueKeys.getKeys(queueName),
      (type: string) => queueKeys.toKey(queueName, type),
      {
        ...this.queue.opts,
        prefix: resolvedPrefix,
      } as QueueBaseOptions & KeyPrefixOptions,
      this.blockingConnection,
      false,
    );
  }

  /**
   * The queue's fully-qualified name (`"<prefix>:<queue>"`). This is the
   * cross-backend logical identifier (e.g. used as a flow parent reference).
   */
  get qualifiedName(): string {
    return `${this.redisPrefix}:${this.name}`;
  }

  /**
   * The concrete Redis keys for this queue (wait, active, events, …).
   */
  get keys(): KeysMap {
    return this.queue.keys;
  }

  /**
   * Builds a namespaced Redis sub-key of the given `type`
   * (`"<prefix>:<queue>:<type>"`).
   */
  toKey(type: string): string {
    return this.queue.toKey(type);
  }

  /**
   * Parses a Redis flow child key (`"<prefix>:<queue>:<id>"`) into its
   * components. Inverse of {@link toKey}.
   */
  parseNodeKey(key: string): { prefix: string; queueName: string; id: string } {
    const lastColon = key.lastIndexOf(':');
    const prevColon = key.lastIndexOf(':', lastColon - 1);
    if (lastColon === -1 || prevColon === -1) {
      const [prefix = '', queueName = '', id = ''] = key.split(':');
      return { prefix, queueName, id };
    }
    const prefix = key.slice(0, prevColon);
    const queueName = key.slice(prevColon + 1, lastColon);
    const id = key.slice(lastColon + 1);
    return { prefix, queueName, id };
  }

  /**
   * Builds the Redis client name (`"<prefix>:<base64(queue)><suffix>"`), used
   * for `CLIENT SETNAME` and worker/queue discovery via `CLIENT LIST`.
   */
  clientName(suffix = ''): string {
    const base64Name = Buffer.from(this.name).toString('base64');
    return `${this.redisPrefix}:${base64Name}${suffix}`;
  }

  /**
   * Normalizes the events of the owned connection(s) into the backend's own
   * `'ready' | 'error' | 'close'` events.
   */
  private forwardConnectionEvents(): void {
    this.connection.on('error', err => this.emit('error', err));
    this.connection.on('ready', () => this.emit('ready'));
    this.connection.on('close', () => this.emit('close'));
    if (this.blockingConnection) {
      this.blockingConnection.on('error', err => this.emit('error', err));
      this.blockingConnection.on('ready', () => this.emit('ready'));
    }
  }

  /**
   * Resolves once the backend's underlying connection(s) are ready.
   */
  async waitUntilReady(): Promise<void> {
    await this.connection.client;
    if (this.blockingConnection) {
      await this.blockingConnection.client;
    }
  }

  /**
   * Closes the backend and its underlying connection(s).
   *
   * The dedicated blocking connection (if any) is closed first so that an
   * in-flight blocking command (e.g. `bzpopmin`) is interrupted before the
   * main connection is closed.
   */
  async close(force = false): Promise<void> {
    if (!this.ownsConnection) {
      return;
    }
    if (!this.closing) {
      this.closing = (async () => {
        if (this.blockingConnection) {
          await this.blockingConnection.close(force);
        }
        await this.connection.close(force);
      })();
    }
    return this.closing;
  }

  /**
   * Forcibly disconnects the backend's underlying connection(s).
   */
  async disconnect(): Promise<void> {
    if (!this.ownsConnection) {
      return;
    }
    await this.connection.disconnect();
    if (this.blockingConnection) {
      await this.blockingConnection.disconnect();
    }
  }

  /**
   * Sets a human-readable name on the underlying connection (CLIENT SETNAME).
   * Unsupported-command and shutdown errors are swallowed.
   */
  async setName(name: string): Promise<void> {
    const client = await this.connection.client;
    try {
      await client.clientSetName(name);
    } catch (err) {
      if (
        !clientCommandMessageReg.test((<Error>err).message) &&
        !this.closing
      ) {
        throw err;
      }
    }
  }

  /**
   * The raw Redis client. Redis-specific escape hatch (used e.g. by
   * `Queue.client`); not part of {@link IQueueBackend}.
   */
  get client(): Promise<RedisClient> {
    return this.connection.client;
  }

  /**
   * The raw blocking Redis client (a dedicated connection used for the
   * blocking `waitForJob` primitive), if this backend was created with one.
   * Redis-specific escape hatch; not part of {@link IQueueBackend}.
   */
  get blockingClient(): Promise<RedisClient> | undefined {
    return this.blockingConnection?.client;
  }

  /**
   * The detected Redis server version. Redis-specific escape hatch; not part
   * of {@link IQueueBackend}.
   */
  get redisVersion(): string {
    return this.connection.redisVersion;
  }

  /**
   * The detected datastore flavour (`redis`, `dragonfly`, `valkey`, …).
   * Redis-specific escape hatch; not part of {@link IQueueBackend}.
   */
  get databaseType(): string {
    return this.connection.databaseType;
  }

  /**
   * Smallest meaningful block timeout (seconds) given the blocking
   * connection's capabilities.
   */
  get minimumBlockTimeout(): number {
    return (this.blockingConnection ?? this.connection).capabilities
      .canBlockFor1Ms
      ? 0.001
      : 0.002;
  }

  /**
   * Interrupts the in-flight blocking wait by disconnecting the dedicated
   * blocking connection. No-op if there is none.
   */
  async disconnectBlocking(wait = true): Promise<void> {
    if (this.blockingConnection) {
      await this.blockingConnection.disconnect(wait);
    }
  }

  /**
   * Re-establishes the dedicated blocking connection after an interrupt.
   */
  async reconnectBlocking(): Promise<void> {
    if (this.blockingConnection) {
      await this.blockingConnection.reconnect();
    }
  }

  /**
   * Executes a registered Lua script on the given Redis client, resolving the
   * versioned command name (e.g. `addJob:<packageVersion>`) so the script
   * belonging to the current BullMQ version is invoked.
   *
   * @param client - The Redis client or pipeline/transaction on which to run the command.
   * @param commandName - The base name of the Lua script (without version suffix).
   * @param args - Positional arguments forwarded to the Lua script (keys followed by argv).
   * @returns The raw result produced by the Lua script.
   *
   * @private
   */
  public execCommand(
    client: RedisClient | IRedisTransaction,
    commandName: string,
    args: any[],
  ): any {
    const commandNameWithVersion = `${commandName}:${this.version}`;
    return client.runCommand(commandNameWithVersion, args);
  }

  /**
   * Checks whether a job with the given id is present in the provided queue
   * state.
   */
  async isJobInState(state: string, jobId: string): Promise<boolean> {
    const client = await this.queue.client;

    if (state === 'wait' || state === 'active' || state === 'paused') {
      const listKey = this.queue.toKey(state);
      let result;
      if (
        isRedisVersionLowerThan(
          this.queue.redisVersion,
          '6.0.6',
          this.queue.databaseType,
        )
      ) {
        result = await this.execCommand(client, 'isJobInList', [
          listKey,
          jobId,
        ]);
      } else {
        result = await client.lpos(listKey, jobId);
      }
      return Number.isInteger(result);
    } else {
      const score = await client.zscore(this.queue.toKey(state), jobId);
      return score !== null;
    }
  }

  protected addDelayedJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
    keysMap: KeysMap = this.queue.keys,
  ): (string | Buffer)[] {
    const queueKeys = keysMap;
    const keys: (string | Buffer)[] = [
      queueKeys.marker,
      queueKeys.meta,
      queueKeys.id,
      queueKeys.delayed,
      queueKeys.completed,
      queueKeys.events,
    ];

    keys.push(pack(args), job.data, encodedOpts);

    return keys;
  }

  protected addDelayedJob(
    client: RedisClient | IRedisTransaction,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
    keys: KeysMap = this.queue.keys,
  ): Promise<string | number> {
    const argsList = this.addDelayedJobArgs(job, encodedOpts, args, keys);

    return this.execCommand(client, 'addDelayedJob', argsList);
  }

  protected addPrioritizedJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
    keysMap: KeysMap = this.queue.keys,
  ): (string | Buffer)[] {
    const queueKeys = keysMap;
    const keys: (string | Buffer)[] = [
      queueKeys.marker,
      queueKeys.meta,
      queueKeys.id,
      queueKeys.prioritized,
      queueKeys.delayed,
      queueKeys.completed,
      queueKeys.active,
      queueKeys.events,
      queueKeys.pc,
    ];

    keys.push(pack(args), job.data, encodedOpts);

    return keys;
  }

  protected addPrioritizedJob(
    client: RedisClient | IRedisTransaction,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
    keys: KeysMap = this.queue.keys,
  ): Promise<string | number> {
    const argsList = this.addPrioritizedJobArgs(job, encodedOpts, args, keys);

    return this.execCommand(client, 'addPrioritizedJob', argsList);
  }

  protected addParentJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
    keysMap: KeysMap = this.queue.keys,
  ): (string | Buffer)[] {
    const queueKeys = keysMap;
    const keys: (string | Buffer)[] = [
      queueKeys.meta,
      queueKeys.id,
      queueKeys.delayed,
      queueKeys['waiting-children'],
      queueKeys.completed,
      queueKeys.events,
    ];

    keys.push(pack(args), job.data, encodedOpts);

    return keys;
  }

  protected addParentJob(
    client: RedisClient | IRedisTransaction,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
    keys: KeysMap = this.queue.keys,
  ): Promise<string | number> {
    const argsList = this.addParentJobArgs(job, encodedOpts, args, keys);

    return this.execCommand(client, 'addParentJob', argsList);
  }

  protected addStandardJobArgs(
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
    keysMap: KeysMap = this.queue.keys,
  ): (string | Buffer)[] {
    const queueKeys = keysMap;
    const keys: (string | Buffer)[] = [
      queueKeys.wait,
      queueKeys.paused,
      queueKeys.meta,
      queueKeys.id,
      queueKeys.completed,
      queueKeys.delayed,
      queueKeys.active,
      queueKeys.events,
      queueKeys.marker,
    ];

    keys.push(pack(args), job.data, encodedOpts);

    return keys;
  }

  protected addStandardJob(
    client: RedisClient | IRedisTransaction,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
    keys: KeysMap = this.queue.keys,
  ): Promise<string | number> {
    const argsList = this.addStandardJobArgs(job, encodedOpts, args, keys);

    return this.execCommand(client, 'addStandardJob', argsList);
  }

  /**
   * Low-level Redis adapter helper: queues/executes a single job insert on the
   * provided client or transaction (pipeline/multi). This is the only place
   * that needs a connection handle; the public {@link addJob} / {@link addJobs}
   * operations obtain it from the backend itself.
   *
   * Kept public (but outside {@link IQueueBackend}) so that flow producers can
   * batch inserts across queues onto a shared transaction.
   */
  async addJobToTransaction(
    client: RedisClient | IRedisTransaction,
    job: JobJson,
    jobId: string,
    parentKeyOpts: ParentKeyOpts = {},
    keys: KeysMap = this.queue.keys,
  ): Promise<string> {
    const opts = job.opts;
    const queueKeys = keys;

    const parent: Record<string, any> = job.parent;

    const args = [
      queueKeys[''],
      typeof jobId !== 'undefined' ? jobId : '',
      job.name,
      job.timestamp,
      job.parentKey || null,
      parentKeyOpts.parentDependenciesKey || null,
      parent,
      job.repeatJobKey,
      job.deduplicationId ? `${queueKeys.de}:${job.deduplicationId}` : null,
    ];

    const encodedOpts = pack(optsAsJSON(opts));

    let result: string | number;

    if (parentKeyOpts.addToWaitingChildren) {
      result = await this.addParentJob(client, job, encodedOpts, args, keys);
    } else if (typeof opts.delay == 'number' && opts.delay > 0) {
      result = await this.addDelayedJob(client, job, encodedOpts, args, keys);
    } else if (opts.priority) {
      result = await this.addPrioritizedJob(
        client,
        job,
        encodedOpts,
        args,
        keys,
      );
    } else {
      result = await this.addStandardJob(client, job, encodedOpts, args, keys);
    }

    if (<number>result < 0) {
      throw this.finishedErrors({
        code: <number>result,
        parentKey: parentKeyOpts.parentKey,
        command: 'addJob',
      });
    }

    return <string>result;
  }

  async addJob(
    job: JobJson,
    jobId: string,
    parentKeyOpts: ParentKeyOpts = {},
  ): Promise<string> {
    const client = await this.queue.client;
    return this.addJobToTransaction(client, job, jobId, parentKeyOpts);
  }

  async addJobs(
    entries: {
      job: JobJson;
      jobId: string;
      parentKeyOpts?: ParentKeyOpts;
    }[],
  ): Promise<string[]> {
    const client = await this.queue.client;
    const pipeline = client.pipeline();

    // Queue each insert on the pipeline. The command is enqueued synchronously,
    // so we do not need to await each call before executing the pipeline.
    for (const entry of entries) {
      this.addJobToTransaction(
        pipeline,
        entry.job,
        entry.jobId,
        entry.parentKeyOpts,
      );
    }

    const results = (await pipeline.exec()) as [null | Error, string][];

    const ids: string[] = [];
    for (const [err, id] of results) {
      if (err) {
        throw err;
      }
      ids.push(id);
    }
    return ids;
  }

  /**
   * Atomically inserts a whole flow (tree) of jobs that may span multiple
   * queues, returning one `[error, idOrCode]` tuple per entry in the same
   * order they were provided. For the Redis adapter this is a single `MULTI`
   * transaction; another backend would use a single SQL transaction.
   *
   * Each entry is self-describing (it carries its own queue `prefix` and
   * `queueName`), so the operation does not need to be bound to a single
   * queue's key map.
   */
  async addFlow(
    entries: {
      jobData: JobJson;
      jobId: string;
      parentKeyOpts: ParentKeyOpts;
      prefix: string;
      queueName: string;
    }[],
  ): Promise<[Error | null, string | number][]> {
    const client = await this.queue.client;
    const multi = client.multi();

    for (const entry of entries) {
      const keys = new QueueKeys(entry.prefix).getKeys(entry.queueName);
      await this.addJobToTransaction(
        multi,
        entry.jobData,
        entry.jobId,
        entry.parentKeyOpts,
        keys,
      );
    }

    return (await multi.exec()) as [Error | null, string | number][];
  }

  protected pauseArgs(pause: boolean): (string | number)[] {
    let src = 'wait',
      dst = 'paused';
    if (!pause) {
      src = 'paused';
      dst = 'wait';
    }

    const keys = [src, dst, 'meta', 'prioritized'].map((name: string) =>
      this.queue.toKey(name),
    );

    keys.push(
      this.queue.keys.events,
      this.queue.keys.delayed,
      this.queue.keys.marker,
    );

    const args = [pause ? 'paused' : 'resumed'];

    return keys.concat(args);
  }

  async pause(pause: boolean): Promise<void> {
    const client = await this.queue.client;

    const args = this.pauseArgs(pause);
    return this.execCommand(client, 'pause', args);
  }

  /**
   * Removes a deduplication key from Redis so that a new job with the same
   * deduplication id can be enqueued again. The key is only removed if it
   * currently maps to the provided `jobId`, preventing races between
   * producers and finishing jobs.
   *
   * @param deduplicationId - The deduplication id whose key should be cleared.
   * @param jobId - The id of the job that currently owns the dedup key.
   * @returns `1` if the key was removed, `0` otherwise.
   *
   * @private
   */
  async removeDeduplicationKey(
    deduplicationId: string,
    jobId: string,
  ): Promise<number> {
    const client = await this.queue.client;
    const queueKeys = this.queue.keys;

    const keys: string[] = [`${queueKeys.de}:${deduplicationId}`];

    const args = [jobId];

    return this.execCommand(
      client,
      'removeDeduplicationKey',
      keys.concat(args),
    );
  }

  /**
   * Registers a job scheduler and enqueues its next delayed iteration.
   * The scheduler stores the template data/options so subsequent iterations
   * can be produced automatically based on the repeat options.
   *
   * @param jobSchedulerId - The id that uniquely identifies this scheduler.
   * @param nextMillis - Timestamp (ms since epoch) for the next iteration.
   * @param templateData - Serialized template data reused for every iteration.
   * @param templateOpts - Redis-encoded job options applied to every iteration.
   * @param opts - Repeat options describing the scheduling pattern.
   * @param delayedJobOpts - Options applied to the next delayed job that is produced.
   * @param producerId - Optional id of the job that produced this iteration, used to prevent duplicates.
   * @returns A tuple of `[jobId, delay]`, where `delay` is the computed delay in milliseconds
   * for the next iteration. When `delay` is `0`, the job is enqueued immediately.
   * @throws An error resolved from `finishedErrors` when the Lua script returns a negative status code.
   *
   * @private
   */
  async addJobScheduler(
    jobSchedulerId: string,
    nextMillis: number,
    templateData: string,
    templateOpts: JobsOptions,
    opts: RepeatableOptions,
    delayedJobOpts: JobsOptions,
    // The job id of the job that produced this next iteration
    producerId?: string,
  ): Promise<[string, number]> {
    const client = await this.queue.client;
    const queueKeys = this.queue.keys;

    const keys: (string | number | Buffer)[] = [
      queueKeys.repeat,
      queueKeys.delayed,
      queueKeys.wait,
      queueKeys.paused,
      queueKeys.meta,
      queueKeys.prioritized,
      queueKeys.marker,
      queueKeys.id,
      queueKeys.events,
      queueKeys.pc,
      queueKeys.active,
    ];

    const args = [
      nextMillis,
      pack(opts),
      jobSchedulerId,
      templateData,
      pack(optsAsJSON(templateOpts)),
      pack(optsAsJSON(delayedJobOpts)),
      Date.now(),
      queueKeys[''],
      producerId ? this.queue.toKey(producerId) : '',
    ];

    const result = await this.execCommand(
      client,
      'addJobScheduler',
      keys.concat(args),
    );

    if (typeof result === 'number' && result < 0) {
      throw this.finishedErrors({
        code: result,
        command: 'addJobScheduler',
      });
    }

    return result;
  }

  async updateJobSchedulerNextMillis(
    jobSchedulerId: string,
    nextMillis: number,
    templateData: string,
    delayedJobOpts: JobsOptions,
    // The job id of the job that produced this next iteration - TODO: remove in next breaking change
    producerId?: string,
  ): Promise<string | null> {
    const client = await this.queue.client;

    const queueKeys = this.queue.keys;

    const keys: (string | number | Buffer)[] = [
      queueKeys.repeat,
      queueKeys.delayed,
      queueKeys.wait,
      queueKeys.paused,
      queueKeys.meta,
      queueKeys.prioritized,
      queueKeys.marker,
      queueKeys.id,
      queueKeys.events,
      queueKeys.pc,
      producerId ? this.queue.toKey(producerId) : '',
      queueKeys.active,
    ];

    const args = [
      nextMillis,
      jobSchedulerId,
      templateData,
      pack(optsAsJSON(delayedJobOpts)),
      Date.now(),
      queueKeys[''],
      producerId,
    ];

    return this.execCommand(client, 'updateJobScheduler', keys.concat(args));
  }

  async removeJobScheduler(jobSchedulerId: string): Promise<number> {
    const client = await this.queue.client;

    const queueKeys = this.queue.keys;

    const keys = [queueKeys.repeat, queueKeys.delayed, queueKeys.events];

    const args = [jobSchedulerId, queueKeys['']];

    return this.execCommand(client, 'removeJobScheduler', keys.concat(args));
  }

  protected removeArgs(
    jobId: string,
    removeChildren: boolean,
  ): (string | number)[] {
    const keys: (string | number)[] = [jobId, 'repeat'].map(name =>
      this.queue.toKey(name),
    );

    const args = [jobId, removeChildren ? 1 : 0, this.queue.toKey('')];

    return keys.concat(args);
  }

  async remove(jobId: string, removeChildren: boolean): Promise<number> {
    const client = await this.queue.client;

    const args = this.removeArgs(jobId, removeChildren);
    const result = await this.execCommand(client, 'removeJob', args);

    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'removeJob',
      });
    }

    return result;
  }

  async removeUnprocessedChildren(jobId: string): Promise<void> {
    const client = await this.queue.client;

    const args = [
      this.queue.toKey(jobId),
      this.queue.keys.meta,
      this.queue.toKey(''),
      jobId,
    ];

    await this.execCommand(client, 'removeUnprocessedChildren', args);
  }

  async extendLock(
    jobId: string,
    token: string,
    duration: number,
    client?: RedisClient | IRedisTransaction,
  ): Promise<number> {
    client = client || (await this.queue.client);
    const args = [
      this.queue.toKey(jobId) + ':lock',
      this.queue.keys.stalled,
      token,
      duration,
      jobId,
    ];
    return this.execCommand(client, 'extendLock', args);
  }

  async extendLocks(
    jobIds: string[],
    tokens: string[],
    duration: number,
  ): Promise<string[]> {
    const client = await this.queue.client;

    const args = [
      this.queue.keys.stalled,
      this.queue.toKey(''),
      pack(tokens),
      pack(jobIds),
      duration,
    ];

    return this.execCommand(client, 'extendLocks', args);
  }

  async updateData<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    data: T,
  ): Promise<void> {
    const client = await this.queue.client;

    const keys = [this.queue.toKey(job.id)];
    const dataJson = JSON.stringify(data);

    const result = await this.execCommand(
      client,
      'updateData',
      keys.concat([dataJson]),
    );

    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId: job.id,
        command: 'updateData',
      });
    }
  }

  async updateProgress(jobId: string, progress: JobProgress): Promise<void> {
    const client = await this.queue.client;

    const keys = [
      this.queue.toKey(jobId),
      this.queue.keys.events,
      this.queue.keys.meta,
    ];
    const progressJson = JSON.stringify(progress);

    const result = await this.execCommand(
      client,
      'updateProgress',
      keys.concat([jobId, progressJson]),
    );

    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'updateProgress',
      });
    }
  }

  async addLog(
    jobId: string,
    logRow: string,
    keepLogs?: number,
  ): Promise<number> {
    const client = await this.queue.client;

    const keys: (string | number)[] = [
      this.queue.toKey(jobId),
      this.queue.toKey(jobId) + ':logs',
    ];

    const result = await this.execCommand(
      client,
      'addLog',
      keys.concat([jobId, logRow, keepLogs ? keepLogs : '']),
    );

    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'addLog',
      });
    }

    return result;
  }

  protected moveToFinishedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    val: any,
    propVal: FinishedPropValAttribute,
    shouldRemove: undefined | boolean | number | KeepJobs,
    target: FinishedStatus,
    token: string,
    timestamp: number,
    fetchNext = true,
    fieldsToUpdate?: Record<string, any>,
  ): (string | number | boolean | Buffer)[] {
    const queueKeys = this.queue.keys;
    const opts: WorkerOptions = <WorkerOptions>this.queue.opts;
    const workerKeepJobs =
      target === 'completed' ? opts.removeOnComplete : opts.removeOnFail;

    const metricsKey = this.queue.toKey(`metrics:${target}`);

    const keys = this.moveToFinishedKeys;
    keys[10] = queueKeys[target];
    keys[11] = this.queue.toKey(job.id ?? '');
    keys[12] = metricsKey;
    keys[13] = this.queue.keys.marker;

    const keepJobs = this.getKeepJobs(shouldRemove, workerKeepJobs);

    const args = [
      job.id,
      timestamp,
      propVal,
      typeof val === 'undefined' ? 'null' : val,
      target,
      !fetchNext || this.queue.closing ? 0 : 1,
      queueKeys[''],
      pack({
        token,
        name: opts.name,
        keepJobs,
        limiter: opts.limiter,
        lockDuration: opts.lockDuration,
        attempts: job.opts.attempts,
        maxMetricsSize: opts.metrics?.maxDataPoints
          ? opts.metrics?.maxDataPoints
          : '',
        fpof: !!job.opts?.failParentOnFailure,
        cpof: !!job.opts?.continueParentOnFailure,
        idof: !!job.opts?.ignoreDependencyOnFailure,
        rdof: !!job.opts?.removeDependencyOnFailure,
      }),
      fieldsToUpdate ? pack(objectToFlatArray(fieldsToUpdate)) : void 0,
    ];

    return keys.concat(args);
  }

  protected getKeepJobs(
    shouldRemove: undefined | boolean | number | KeepJobs,
    workerKeepJobs: undefined | KeepJobs,
  ) {
    if (typeof shouldRemove === 'undefined') {
      return workerKeepJobs || { count: shouldRemove ? 0 : -1 };
    }

    return typeof shouldRemove === 'object'
      ? shouldRemove
      : typeof shouldRemove === 'number'
        ? { count: shouldRemove }
        : { count: shouldRemove ? 0 : -1 };
  }

  async moveToFinished(
    jobId: string,
    args: (string | number | boolean | Buffer)[],
  ) {
    const client = await this.queue.client;

    const result = await this.execCommand(client, 'moveToFinished', args);
    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'moveToFinished',
        state: 'active',
      });
    } else {
      if (typeof result !== 'undefined') {
        return raw2NextJobData(result);
      }
    }
  }

  private drainArgs(delayed: boolean): (string | number)[] {
    const queueKeys = this.queue.keys;

    const keys: (string | number)[] = [
      queueKeys.wait,
      queueKeys.paused,
      queueKeys.delayed,
      queueKeys.prioritized,
      queueKeys.repeat,
    ];

    const args = [queueKeys[''], delayed ? '1' : '0'];

    return keys.concat(args);
  }

  async drain(delayed: boolean): Promise<void> {
    const client = await this.queue.client;
    const args = this.drainArgs(delayed);

    return this.execCommand(client, 'drain', args);
  }

  private removeChildDependencyArgs(
    jobId: string,
    parentKey: string,
  ): (string | number)[] {
    const queueKeys = this.queue.keys;

    const keys: string[] = [queueKeys['']];

    const args = [this.queue.toKey(jobId), parentKey];

    return keys.concat(args);
  }

  async removeChildDependency(
    jobId: string,
    parentKey: string,
  ): Promise<boolean> {
    const client = await this.queue.client;
    const args = this.removeChildDependencyArgs(jobId, parentKey);

    const result = await this.execCommand(
      client,
      'removeChildDependency',
      args,
    );

    switch (result) {
      case 0:
        return true;
      case 1:
        return false;
      default:
        throw this.finishedErrors({
          code: result,
          jobId,
          parentKey,
          command: 'removeChildDependency',
        });
    }
  }

  private getRangesArgs(
    types: JobType[],
    start: number,
    end: number,
    asc: boolean,
  ): (string | number)[] {
    const queueKeys = this.queue.keys;
    const transformedTypes = types.map(type => {
      return type === 'waiting' ? 'wait' : type;
    });

    const keys: (string | number)[] = [queueKeys['']];

    const args = [start, end, asc ? '1' : '0', ...transformedTypes];

    return keys.concat(args);
  }

  async getRanges(
    types: JobType[],
    start = 0,
    end = 1,
    asc = false,
  ): Promise<[string][]> {
    const client = await this.queue.client;
    const args = this.getRangesArgs(types, start, end, asc);

    return await this.execCommand(client, 'getRanges', args);
  }

  private getCountsArgs(types: JobType[]): (string | number)[] {
    const queueKeys = this.queue.keys;
    const transformedTypes = types.map(type => {
      return type === 'waiting' ? 'wait' : type;
    });

    const keys: (string | number)[] = [queueKeys['']];

    const args = [...transformedTypes];

    return keys.concat(args);
  }

  async getCounts(types: JobType[]): Promise<number[]> {
    const client = await this.queue.client;
    const args = this.getCountsArgs(types);

    return await this.execCommand(client, 'getCounts', args);
  }

  protected getCountsPerPriorityArgs(
    priorities: number[],
  ): (string | number)[] {
    const keys: (string | number)[] = [
      this.queue.keys.wait,
      this.queue.keys.paused,
      this.queue.keys.meta,
      this.queue.keys.prioritized,
    ];

    const args = priorities;

    return keys.concat(args);
  }

  async getCountsPerPriority(priorities: number[]): Promise<number[]> {
    const client = await this.queue.client;
    const args = this.getCountsPerPriorityArgs(priorities);

    return await this.execCommand(client, 'getCountsPerPriority', args);
  }

  protected getDependencyCountsArgs(
    jobId: string,
    types: string[],
  ): (string | number)[] {
    const keys: string[] = [
      `${jobId}:processed`,
      `${jobId}:dependencies`,
      `${jobId}:failed`,
      `${jobId}:unsuccessful`,
    ].map(name => {
      return this.queue.toKey(name);
    });

    const args = types;

    return keys.concat(args);
  }

  async getDependencyCounts(jobId: string, types: string[]): Promise<number[]> {
    const client = await this.queue.client;
    const args = this.getDependencyCountsArgs(jobId, types);

    return await this.execCommand(client, 'getDependencyCounts', args);
  }

  moveToCompletedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    returnvalue: R,
    removeOnComplete: boolean | number | KeepJobs,
    token: string,
    fetchNext = false,
  ): (string | number | boolean | Buffer)[] {
    const timestamp = Date.now();
    return this.moveToFinishedArgs(
      job,
      returnvalue,
      'returnvalue',
      removeOnComplete,
      'completed',
      token,
      timestamp,
      fetchNext,
    );
  }

  moveToFailedArgs<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    failedReason: string,
    removeOnFailed: boolean | number | KeepJobs,
    token: string,
    fetchNext = false,
    fieldsToUpdate?: Record<string, any>,
  ): (string | number | boolean | Buffer)[] {
    const timestamp = Date.now();
    return this.moveToFinishedArgs(
      job,
      failedReason,
      'failedReason',
      removeOnFailed,
      'failed',
      token,
      timestamp,
      fetchNext,
      fieldsToUpdate,
    );
  }

  async isFinished(
    jobId: string,
    returnValue = false,
  ): Promise<number | [number, string]> {
    const client = await this.queue.client;

    const keys = ['completed', 'failed', jobId].map((key: string) => {
      return this.queue.toKey(key);
    });

    return this.execCommand(
      client,
      'isFinished',
      keys.concat([jobId, returnValue ? '1' : '']),
    );
  }

  async getState(jobId: string): Promise<JobState | 'unknown'> {
    const client = await this.queue.client;

    const keys = [
      'completed',
      'failed',
      'delayed',
      'active',
      'wait',
      'paused',
      'waiting-children',
      'prioritized',
    ].map((key: string) => {
      return this.queue.toKey(key);
    });

    if (
      isRedisVersionLowerThan(
        this.queue.redisVersion,
        '6.0.6',
        this.queue.databaseType,
      )
    ) {
      return this.execCommand(client, 'getState', keys.concat([jobId]));
    }
    return this.execCommand(client, 'getStateV2', keys.concat([jobId]));
  }

  /**
   * Change delay of a delayed job.
   *
   * Reschedules a delayed job by setting a new delay from the current time.
   * For example, calling changeDelay(5000) will reschedule the job to execute
   * 5000 milliseconds (5 seconds) from now, regardless of the original delay.
   *
   * @param jobId - the ID of the job to change the delay for.
   * @param delay - milliseconds from now when the job should be processed.
   * @returns delay in milliseconds.
   * @throws JobNotExist
   * This exception is thrown if jobId is missing.
   * @throws JobNotInState
   * This exception is thrown if job is not in delayed state.
   */
  async changeDelay(jobId: string, delay: number): Promise<void> {
    const client = await this.queue.client;

    const args = this.changeDelayArgs(jobId, delay);
    const result = await this.execCommand(client, 'changeDelay', args);
    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'changeDelay',
        state: 'delayed',
      });
    }
  }

  private changeDelayArgs(jobId: string, delay: number): (string | number)[] {
    const timestamp = Date.now();

    const keys: (string | number)[] = [
      this.queue.keys.delayed,
      this.queue.keys.meta,
      this.queue.keys.marker,
      this.queue.keys.events,
    ];

    return keys.concat([
      delay,
      JSON.stringify(timestamp),
      jobId,
      this.queue.toKey(jobId),
    ]);
  }

  async changePriority(
    jobId: string,
    priority = 0,
    lifo = false,
  ): Promise<void> {
    const client = await this.queue.client;

    const args = this.changePriorityArgs(jobId, priority, lifo);

    const result = await this.execCommand(client, 'changePriority', args);
    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'changePriority',
      });
    }
  }

  protected changePriorityArgs(
    jobId: string,
    priority = 0,
    lifo = false,
  ): (string | number)[] {
    const keys: (string | number)[] = [
      this.queue.keys.wait,
      this.queue.keys.paused,
      this.queue.keys.meta,
      this.queue.keys.prioritized,
      this.queue.keys.active,
      this.queue.keys.pc,
      this.queue.keys.marker,
    ];

    return keys.concat([priority, this.queue.toKey(''), jobId, lifo ? 1 : 0]);
  }

  moveToDelayedArgs(
    jobId: string,
    timestamp: number,
    token: string,
    delay: number,
    opts: MoveToDelayedOpts = {},
  ): (string | number | Buffer)[] {
    const queueKeys = this.queue.keys;
    const workerOpts: WorkerOptions = <WorkerOptions>this.queue.opts;

    const keys: (string | number | Buffer)[] = [
      queueKeys.marker,
      queueKeys.active,
      queueKeys.prioritized,
      queueKeys.delayed,
      this.queue.toKey(jobId),
      queueKeys.events,
      queueKeys.meta,
      queueKeys.stalled,
      queueKeys.wait,
      queueKeys.limiter,
      queueKeys.paused,
      queueKeys.pc,
    ];

    const fetchNext = opts.fetchNext && !this.queue.closing ? 1 : 0;

    return keys.concat([
      this.queue.keys[''],
      timestamp,
      jobId,
      token,
      delay,
      opts.skipAttempt ? '1' : '0',
      opts.fieldsToUpdate
        ? pack(objectToFlatArray(opts.fieldsToUpdate))
        : void 0,
      fetchNext,
      fetchNext
        ? pack({
            token,
            lockDuration: workerOpts.lockDuration,
            limiter: workerOpts.limiter,
            name: workerOpts.name,
          })
        : void 0,
    ]);
  }

  moveToWaitingChildrenArgs(
    jobId: string,
    token: string,
    opts?: MoveToWaitingChildrenOpts,
  ): (string | number)[] {
    const timestamp = Date.now();

    const childKey = getParentKey(opts.child);

    const keys: (string | number)[] = [
      'active',
      'waiting-children',
      jobId,
      `${jobId}:dependencies`,
      `${jobId}:unsuccessful`,
      'stalled',
      'events',
    ].map(name => {
      return this.queue.toKey(name);
    });

    return keys.concat([
      token,
      childKey ?? '',
      JSON.stringify(timestamp),
      jobId,
      this.queue.toKey(''),
    ]);
  }

  isMaxedArgs(): string[] {
    const queueKeys = this.queue.keys;
    const keys: string[] = [queueKeys.meta, queueKeys.active];

    return keys;
  }

  async isMaxed(): Promise<boolean> {
    const client = await this.queue.client;

    const args = this.isMaxedArgs();
    return !!(await this.execCommand(client, 'isMaxed', args));
  }

  async moveToDelayed(
    jobId: string,
    timestamp: number,
    delay: number,
    token = '0',
    opts: MoveToDelayedOpts = {},
  ): Promise<void | any[]> {
    const client = await this.queue.client;

    const args = this.moveToDelayedArgs(jobId, timestamp, token, delay, opts);

    const result = await this.execCommand(client, 'moveToDelayed', args);
    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'moveToDelayed',
        state: 'active',
      });
    } else if (typeof result !== 'undefined') {
      return raw2NextJobData(result);
    }
  }

  /**
   * Move parent job to waiting-children state.
   *
   * @returns true if job is successfully moved, false if there are pending dependencies.
   * @throws JobNotExist
   * This exception is thrown if jobId is missing.
   * @throws JobLockNotExist
   * This exception is thrown if job lock is missing.
   * @throws JobNotInState
   * This exception is thrown if job is not in active state.
   */
  async moveToWaitingChildren(
    jobId: string,
    token: string,
    opts: MoveToWaitingChildrenOpts = {},
  ): Promise<boolean> {
    const client = await this.queue.client;

    const args = this.moveToWaitingChildrenArgs(jobId, token, opts);
    const result = await this.execCommand(
      client,
      'moveToWaitingChildren',
      args,
    );

    switch (result) {
      case 0:
        return true;
      case 1:
        return false;
      default:
        throw this.finishedErrors({
          code: result,
          jobId,
          command: 'moveToWaitingChildren',
          state: 'active',
        });
    }
  }

  getRateLimitTtlArgs(maxJobs?: number): (string | number)[] {
    const keys: (string | number)[] = [
      this.queue.keys.limiter,
      this.queue.keys.meta,
    ];

    return keys.concat([maxJobs ?? '0']);
  }

  async getRateLimitTtl(maxJobs?: number): Promise<number> {
    const client = await this.queue.client;

    const args = this.getRateLimitTtlArgs(maxJobs);
    return this.execCommand(client, 'getRateLimitTtl', args);
  }

  /**
   * Remove jobs in a specific state.
   *
   * @returns Id jobs from the deleted records.
   */
  async cleanJobsByState(
    state: string,
    timestamp: number,
    limit = 0,
  ): Promise<string[]> {
    const client = await this.queue.client;

    return this.execCommand(client, 'cleanJobsInSet', [
      this.queue.toKey(state),
      this.queue.toKey('events'),
      this.queue.toKey('repeat'),
      this.queue.toKey(''),
      timestamp,
      limit,
      state,
    ]);
  }

  getJobSchedulerArgs(id: string): string[] {
    const keys: string[] = [this.queue.keys.repeat];

    return keys.concat([id]);
  }

  async getJobScheduler(id: string): Promise<[any, string | null]> {
    const client = await this.queue.client;

    const args = this.getJobSchedulerArgs(id);

    return this.execCommand(client, 'getJobScheduler', args);
  }

  async isJobScheduler(id: string): Promise<boolean> {
    const client = await this.queue.client;
    const exists = await client.hexists(
      `${this.queue.keys.repeat}:${id}`,
      'ic',
    );
    return exists === 1;
  }

  async getJobSchedulerData(key: string): Promise<Record<string, string>> {
    const client = await this.queue.client;
    return client.hgetall(this.queue.toKey('repeat:' + key));
  }

  async getJobSchedulersRange(
    start: number,
    end: number,
    asc: boolean,
  ): Promise<string[]> {
    const client = await this.queue.client;
    const key = this.queue.keys.repeat;
    return asc
      ? client.zrange(key, start, end, { WITHSCORES: true })
      : client.zrevrange(key, start, end, { WITHSCORES: true });
  }

  async getJobSchedulersCount(): Promise<number> {
    const client = await this.queue.client;
    return client.zcard(this.queue.keys.repeat);
  }

  retryJobArgs(
    jobId: string,
    lifo: boolean,
    token: string,
    opts: MoveToDelayedOpts = {},
  ): (string | number | Buffer)[] {
    const keys: (string | number | Buffer)[] = [
      this.queue.keys.active,
      this.queue.keys.wait,
      this.queue.keys.paused,
      this.queue.toKey(jobId),
      this.queue.keys.meta,
      this.queue.keys.events,
      this.queue.keys.delayed,
      this.queue.keys.prioritized,
      this.queue.keys.pc,
      this.queue.keys.marker,
      this.queue.keys.stalled,
    ];

    const pushCmd = (lifo ? 'R' : 'L') + 'PUSH';

    return keys.concat([
      this.queue.toKey(''),
      Date.now(),
      pushCmd,
      jobId,
      token,
      opts.fieldsToUpdate
        ? pack(objectToFlatArray(opts.fieldsToUpdate))
        : void 0,
    ]);
  }

  async retryJob(
    jobId: string,
    lifo: boolean,
    token = '0',
    opts: RetryJobOpts = {},
  ): Promise<void> {
    const client = await this.queue.client;

    const args = this.retryJobArgs(jobId, lifo, token, opts);
    const result = await this.execCommand(client, 'retryJob', args);
    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'retryJob',
        state: 'active',
      });
    }
  }

  protected moveJobsToWaitArgs(
    state: FinishedStatus | 'delayed',
    count: number,
    timestamp: number,
  ): (string | number)[] {
    const keys: (string | number)[] = [
      this.queue.toKey(''),
      this.queue.keys.events,
      this.queue.toKey(state),
      this.queue.toKey('wait'),
      this.queue.toKey('paused'),
      this.queue.keys.meta,
      this.queue.keys.active,
      this.queue.keys.marker,
    ];

    const args = [count, timestamp, state];

    return keys.concat(args);
  }

  async retryFinishedJobs(
    state: FinishedStatus = 'failed',
    count = 1000,
    timestamp = new Date().getTime(),
  ): Promise<number> {
    const client = await this.queue.client;

    const args = this.moveJobsToWaitArgs(state, count, timestamp);

    return this.execCommand(client, 'moveJobsToWait', args);
  }

  async promoteJobs(count = 1000): Promise<number> {
    const client = await this.queue.client;

    const args = this.moveJobsToWaitArgs('delayed', count, Number.MAX_VALUE);

    return this.execCommand(client, 'moveJobsToWait', args);
  }

  /**
   * Attempts to reprocess a job
   *
   * @param job - The job to reprocess
   * @param state - The expected job state. If the job is not found
   * on the provided state, then it's not reprocessed. Supported states: 'failed', 'completed'
   *
   * @returns A promise that resolves when the job has been successfully moved to the wait queue.
   * @throws Will throw an error with a code property indicating the failure reason:
   *   - code 0: Job does not exist
   *   - code -1: Job is currently locked and can't be retried
   *   - code -2: Job was not found in the expected set
   */
  async retryFinishedJob<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    state: 'failed' | 'completed',
    opts: RetryOptions = {},
  ): Promise<void> {
    const client = await this.queue.client;

    const keys = [
      this.queue.toKey(job.id),
      this.queue.keys.events,
      this.queue.toKey(state),
      this.queue.keys.wait,
      this.queue.keys.meta,
      this.queue.keys.paused,
      this.queue.keys.active,
      this.queue.keys.marker,
    ];

    const args = [
      job.id,
      (job.opts.lifo ? 'R' : 'L') + 'PUSH',
      state === 'failed' ? 'failedReason' : 'returnvalue',
      state,
      opts.resetAttemptsMade ? '1' : '0',
      opts.resetAttemptsStarted ? '1' : '0',
    ];

    const result = await this.execCommand(
      client,
      'reprocessJob',
      keys.concat(args),
    );

    switch (result) {
      case 1:
        return;
      default:
        throw this.finishedErrors({
          code: result,
          jobId: job.id,
          command: 'reprocessJob',
          state,
        });
    }
  }

  async getMetrics(
    type: 'completed' | 'failed',
    start = 0,
    end = -1,
  ): Promise<[string[], string[], number]> {
    const client = await this.queue.client;

    const keys: (string | number)[] = [
      this.queue.toKey(`metrics:${type}`),
      this.queue.toKey(`metrics:${type}:data`),
    ];
    const args = [start, end];

    const result = await this.execCommand(
      client,
      'getMetrics',
      keys.concat(args),
    );

    return result;
  }

  async getClientList(): Promise<string[]> {
    const client = await this.queue.client;
    if (client.isCluster && typeof client.nodes === 'function') {
      const clusterNodes = client.nodes() || [];
      return Promise.all(
        clusterNodes.map((node: any) =>
          typeof node.clientList === 'function'
            ? node.clientList()
            : node.client('LIST'),
        ),
      );
    }
    return [await client.clientList()];
  }

  async moveToActive(token: string, name?: string) {
    const client = await this.queue.client;
    const opts = this.queue.opts as WorkerOptions;

    const queueKeys = this.queue.keys;
    const keys = [
      queueKeys.wait,
      queueKeys.active,
      queueKeys.prioritized,
      queueKeys.events,
      queueKeys.stalled,
      queueKeys.limiter,
      queueKeys.delayed,
      queueKeys.paused,
      queueKeys.meta,
      queueKeys.pc,
      queueKeys.marker,
    ];

    const args: (string | number | boolean | Buffer)[] = [
      queueKeys[''],
      Date.now(),
      pack({
        token,
        lockDuration: opts.lockDuration,
        limiter: opts.limiter,
        name,
      }),
    ];

    const result = await this.execCommand(
      client,
      'moveToActive',
      (<(string | number | boolean | Buffer)[]>keys).concat(args),
    );

    return raw2NextJobData(result);
  }

  async promote(jobId: string): Promise<void> {
    const client = await this.queue.client;

    const keys = [
      this.queue.keys.delayed,
      this.queue.keys.wait,
      this.queue.keys.paused,
      this.queue.keys.meta,
      this.queue.keys.prioritized,
      this.queue.keys.active,
      this.queue.keys.pc,
      this.queue.keys.events,
      this.queue.keys.marker,
    ];

    const args = [this.queue.toKey(''), jobId];

    const code = await this.execCommand(client, 'promote', keys.concat(args));
    if (code < 0) {
      throw this.finishedErrors({
        code,
        jobId,
        command: 'promote',
        state: 'delayed',
      });
    }
  }

  protected moveStalledJobsToWaitArgs(): (string | number)[] {
    const opts = this.queue.opts as WorkerOptions;
    const keys: (string | number)[] = [
      this.queue.keys.stalled,
      this.queue.keys.wait,
      this.queue.keys.active,
      this.queue.keys['stalled-check'],
      this.queue.keys.meta,
      this.queue.keys.paused,
      this.queue.keys.marker,
      this.queue.keys.events,
      this.queue.keys.repeat,
    ];
    const args = [
      opts.maxStalledCount,
      this.queue.toKey(''),
      Date.now(),
      opts.stalledInterval,
    ];

    return keys.concat(args);
  }

  /**
   * Looks for unlocked jobs in the active queue.
   *
   * The job was being worked on, but the worker process died and it failed to renew the lock.
   * We call these jobs 'stalled'. This is the most common case. We resolve these by moving them
   * back to wait to be re-processed. To prevent jobs from cycling endlessly between active and wait,
   * (e.g. if the job handler keeps crashing),
   * we limit the number stalled job recoveries to settings.maxStalledCount.
   */
  async moveStalledJobsToWait(): Promise<string[]> {
    const client = await this.queue.client;

    const args = this.moveStalledJobsToWaitArgs();

    return this.execCommand(client, 'moveStalledJobsToWait', args);
  }

  /**
   * Moves a job back from Active to Wait.
   * This script is used when a job has been manually rate limited and needs
   * to be moved back to wait from active status.
   *
   * @param client - Redis client
   * @param jobId - Job id
   * @returns
   */
  async moveJobFromActiveToWait(jobId: string, token = '0') {
    const client = await this.queue.client;

    const keys: (string | number)[] = [
      this.queue.keys.active,
      this.queue.keys.wait,
      this.queue.keys.stalled,
      this.queue.keys.paused,
      this.queue.keys.meta,
      this.queue.keys.limiter,
      this.queue.keys.prioritized,
      this.queue.keys.marker,
      this.queue.keys.events,
    ];

    const args = [jobId, token, this.queue.toKey(jobId)];

    const result = await this.execCommand(
      client,
      'moveJobFromActiveToWait',
      keys.concat(args),
    );

    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'moveJobFromActiveToWait',
        state: 'active',
      });
    }

    return result;
  }

  async obliterate(opts: { force: boolean; count: number }): Promise<number> {
    const client = await this.queue.client;

    const keys: (string | number)[] = [
      this.queue.keys.meta,
      this.queue.toKey(''),
    ];
    const args = [opts.count, opts.force ? 'force' : null];

    const result = await this.execCommand(
      client,
      'obliterate',
      keys.concat(args),
    );
    if (result < 0) {
      switch (result) {
        case -1:
          throw new Error('Cannot obliterate non-paused queue');
        case -2:
          throw new Error('Cannot obliterate queue with active jobs');
      }
    }
    return result;
  }

  /**
   * Paginate a set or hash keys.
   * @param opts - options to define the pagination behaviour
   *
   */
  async paginate(
    key: string,
    opts: { start: number; end: number; fetchJobs?: boolean },
  ): Promise<{
    cursor: string;
    items: { id: string; v?: any; err?: string }[];
    total: number;
    jobs?: JobJson[];
  }> {
    const client = await this.queue.client;

    const keys: (string | number)[] = [key];

    const maxIterations = 5;

    const pageSize = opts.end >= 0 ? opts.end - opts.start + 1 : Infinity;

    let cursor = '0',
      offset = 0,
      items,
      total,
      rawJobs,
      page: string[] = [],
      jobs: JobJson[] = [];
    do {
      const args = [
        opts.start + page.length,
        opts.end,
        cursor,
        offset,
        maxIterations,
      ];

      if (opts.fetchJobs) {
        args.push(1);
      }

      [cursor, offset, items, total, rawJobs] = await this.execCommand(
        client,
        'paginate',
        keys.concat(args),
      );

      page = page.concat(items);

      if (rawJobs && rawJobs.length) {
        jobs = jobs.concat(
          rawJobs.map((rawJob: any) =>
            rawToJobJson(array2obj(rawJob) as unknown as JobJsonRaw),
          ),
        );
      }

      // Important to keep this coercive inequality (!=) instead of strict inequality (!==)
    } while (cursor != '0' && page.length < pageSize);

    // If we get an array of arrays, it means we are paginating a hash
    if (page.length && Array.isArray(page[0])) {
      const result = [];
      for (let index = 0; index < page.length; index++) {
        const [id, value] = page[index];
        try {
          result.push({ id, v: JSON.parse(value) });
        } catch (err) {
          result.push({ id, err: (<Error>err).message });
        }
      }

      return {
        cursor,
        items: result,
        total,
        jobs,
      };
    } else {
      return {
        cursor,
        items: page.map(item => ({ id: item })),
        total,
        jobs,
      };
    }
  }

  finishedErrors({
    code,
    jobId,
    parentKey,
    command,
    state,
  }: {
    code: number;
    jobId?: string;
    parentKey?: string;
    command: string;
    state?: string;
  }): Error {
    return finishedErrors({ code, jobId, parentKey, command, state });
  }

  /**
   * Low-level Redis adapter helper: atomically check-and-delete a single batch
   * of candidate orphaned jobs. Driven by {@link removeOrphanedJobs}.
   */
  protected async removeOrphanedJobsBatch(
    candidateJobIds: string[],
    stateKeySuffixes: string[],
    jobSubKeySuffixes: string[],
  ): Promise<number> {
    const client = await this.queue.client;

    const args: (string | number)[] = [
      this.queue.toKey(''),
      stateKeySuffixes.length,
      ...stateKeySuffixes,
      jobSubKeySuffixes.length,
      ...jobSubKeySuffixes,
      ...candidateJobIds,
    ];

    return this.execCommand(client, 'removeOrphanedJobs', args);
  }

  async removeOrphanedJobs(count = 1000, limit = 0): Promise<number> {
    const client = await this.queue.client;
    const keys = this.queue.keys;

    // Derive infrastructure suffixes dynamically from the queue key map
    // so any future keys are automatically excluded without code changes.
    const knownSuffixes = new Set(Object.keys(keys));

    // State key suffixes (excluding '') — passed to the Lua script which
    // uses TYPE to decide whether a key is a list / zset / set.
    const stateKeySuffixes = Object.keys(keys).filter(s => s !== '');

    // Known job sub-key suffixes (cleaned up during deletion).
    const jobSubKeySuffixes = [
      'logs',
      'dependencies',
      'processed',
      'failed',
      'unsuccessful',
      'lock',
    ];

    const basePrefix = keys[''];
    const scanPattern = basePrefix + '*';
    let totalRemoved = 0;

    let cursor = '0';
    do {
      const [nextCursor, scannedKeys] = await client.scan(cursor, {
        MATCH: scanPattern,
        COUNT: count,
      });
      cursor = nextCursor;

      // Extract unique potential job IDs from this batch.
      const candidateJobIds = new Set<string>();
      for (const key of scannedKeys) {
        const suffix = key.slice(basePrefix.length);

        // Skip infrastructure keys (derived from the key map).
        if (knownSuffixes.has(suffix)) {
          continue;
        }

        // Skip sub-keys of infrastructure prefixes (e.g. repeat:xxx, de:xxx).
        const colonIdx = suffix.indexOf(':');
        if (colonIdx !== -1) {
          const prefixPart = suffix.slice(0, colonIdx);
          if (knownSuffixes.has(prefixPart)) {
            continue;
          }
        }

        // Extract the job ID portion (before first colon, or the whole suffix).
        const jobId = colonIdx === -1 ? suffix : suffix.slice(0, colonIdx);

        // For sub-keys, only consider known job sub-key suffixes.
        if (colonIdx !== -1) {
          const subKey = suffix.slice(colonIdx + 1);
          if (!jobSubKeySuffixes.includes(subKey)) {
            continue;
          }
        }

        candidateJobIds.add(jobId);
      }

      if (candidateJobIds.size === 0) {
        continue;
      }

      // Run the Lua script atomically for this batch of candidates.
      const result = await this.removeOrphanedJobsBatch(
        [...candidateJobIds],
        stateKeySuffixes,
        jobSubKeySuffixes,
      );

      totalRemoved += result || 0;

      if (limit > 0 && totalRemoved >= limit) {
        break;
      }
    } while (cursor !== '0');

    return totalRemoved;
  }

  // ============================================================
  // High-level finished transitions (consolidate Lua arg-building + exec)
  // ============================================================

  async moveToCompleted<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    returnValue: R,
    removeOnComplete: boolean | number | KeepJobs,
    token: string,
    fetchNext: boolean,
  ): Promise<{ result: void | any[]; finishedOn: number }> {
    const stringifiedReturnValue = tryCatch(JSON.stringify, JSON, [
      returnValue,
    ]);
    if (stringifiedReturnValue === errorObject) {
      throw errorObject.value;
    }

    const args = this.moveToCompletedArgs(
      job,
      stringifiedReturnValue,
      removeOnComplete,
      token,
      fetchNext,
    );

    const result = await this.moveToFinished(job.id, args);
    const finishedOn = args[this.moveToFinishedKeys.length + 1] as number;

    return { result, finishedOn };
  }

  async moveToFailed<T = any, R = any, N extends string = string>(
    job: MinimalJob<T, R, N>,
    failedReason: string,
    removeOnFail: boolean | number | KeepJobs,
    token: string,
    fetchNext: boolean,
    fieldsToUpdate?: Record<string, any>,
  ): Promise<{ result: void | any[]; finishedOn: number }> {
    const args = this.moveToFailedArgs(
      job,
      failedReason,
      removeOnFail,
      token,
      fetchNext,
      fieldsToUpdate,
    );

    const result = await this.moveToFinished(job.id, args);
    const finishedOn = args[this.moveToFinishedKeys.length + 1] as number;

    return { result, finishedOn };
  }

  // ============================================================
  // Promoted job getters (previously direct client calls in Job)
  // ============================================================

  async getJobData(jobId: string): Promise<JobJson | undefined> {
    const client = await this.queue.client;
    const jobData = await client.hgetall(this.queue.toKey(jobId));
    return isEmpty(jobData)
      ? undefined
      : rawToJobJson(jobData as unknown as JobJsonRaw);
  }

  async getDeduplicationJobId(deduplicationId: string): Promise<string | null> {
    const client = await this.queue.client;
    return client.get(`${this.queue.keys.de}:${deduplicationId}`);
  }

  async getJobLogs(
    jobId: string,
    start: number,
    end: number,
    asc: boolean,
  ): Promise<{ logs: string[]; count: number }> {
    const client = await this.queue.client;
    const multi = client.multi();

    const logsKey = this.queue.toKey(jobId + ':logs');
    if (asc) {
      multi.lrange(logsKey, start, end);
    } else {
      multi.lrange(logsKey, -(end + 1), -(start + 1));
    }
    multi.llen(logsKey);
    const result = (await multi.exec()) as [[Error, [string]], [Error, number]];
    if (!asc) {
      result[0][1].reverse();
    }
    return {
      logs: result[0][1],
      count: result[1][1],
    };
  }

  async clearLogs(jobId: string, keepLogs?: number): Promise<void> {
    const client = await this.queue.client;
    const logsKey = this.queue.toKey(jobId) + ':logs';

    if (keepLogs) {
      await client.ltrim(logsKey, -keepLogs, -1);
    } else {
      await client.del(logsKey);
    }
  }

  async getProcessedChildrenValues(
    jobId: string,
  ): Promise<Record<string, string>> {
    const client = await this.queue.client;
    return (await client.hgetall(
      this.queue.toKey(`${jobId}:processed`),
    )) as Record<string, string>;
  }

  async getIgnoredChildrenFailures(
    jobId: string,
  ): Promise<Record<string, string>> {
    const client = await this.queue.client;
    return client.hgetall(this.queue.toKey(`${jobId}:failed`));
  }

  async getDependencies(
    jobId: string,
    opts: DependenciesOpts = {},
  ): Promise<{
    nextFailedCursor?: number;
    failed?: string[];
    nextIgnoredCursor?: number;
    ignored?: Record<string, any>;
    nextProcessedCursor?: number;
    processed?: Record<string, any>;
    nextUnprocessedCursor?: number;
    unprocessed?: string[];
  }> {
    const client = await this.queue.client;
    const multi = client.pipeline();
    if (!opts.processed && !opts.unprocessed && !opts.ignored && !opts.failed) {
      multi.hgetall(this.queue.toKey(`${jobId}:processed`));
      multi.smembers(this.queue.toKey(`${jobId}:dependencies`));
      multi.hgetall(this.queue.toKey(`${jobId}:failed`));
      multi.zrange(this.queue.toKey(`${jobId}:unsuccessful`), 0, -1);

      const [
        [err1, processed],
        [err2, unprocessed],
        [err3, ignored],
        [err4, failed],
      ] = (await multi.exec()) as [
        [null | Error, { [jobKey: string]: string }],
        [null | Error, string[]],
        [null | Error, { [jobKey: string]: string }],
        [null | Error, string[]],
      ];

      return {
        processed: parseObjectValues(processed),
        unprocessed,
        failed,
        ignored,
      };
    } else {
      const defaultOpts = {
        cursor: 0,
        count: 20,
      };

      const childrenResultOrder = [];
      if (opts.processed) {
        childrenResultOrder.push('processed');
        const processedOpts = Object.assign({ ...defaultOpts }, opts.processed);
        multi.hscan(
          this.queue.toKey(`${jobId}:processed`),
          processedOpts.cursor,
          {
            COUNT: processedOpts.count,
          },
        );
      }

      if (opts.unprocessed) {
        childrenResultOrder.push('unprocessed');
        const unprocessedOpts = Object.assign(
          { ...defaultOpts },
          opts.unprocessed,
        );
        multi.sscan(
          this.queue.toKey(`${jobId}:dependencies`),
          unprocessedOpts.cursor,
          { COUNT: unprocessedOpts.count },
        );
      }

      if (opts.ignored) {
        childrenResultOrder.push('ignored');
        const ignoredOpts = Object.assign({ ...defaultOpts }, opts.ignored);
        multi.hscan(this.queue.toKey(`${jobId}:failed`), ignoredOpts.cursor, {
          COUNT: ignoredOpts.count,
        });
      }

      let failedCursor;
      if (opts.failed) {
        childrenResultOrder.push('failed');
        const failedOpts = Object.assign({ ...defaultOpts }, opts.failed);
        failedCursor = failedOpts.cursor + failedOpts.count;
        multi.zrange(
          this.queue.toKey(`${jobId}:unsuccessful`),
          failedOpts.cursor,
          failedOpts.count - 1,
        );
      }

      const results = (await multi.exec()) as [
        Error,
        [number[], string[] | undefined],
      ][];

      let processedCursor,
        processed,
        unprocessedCursor,
        unprocessed,
        failed,
        ignoredCursor,
        ignored;
      childrenResultOrder.forEach((key, index) => {
        switch (key) {
          case 'processed': {
            processedCursor = results[index][1][0];
            const rawProcessed = results[index][1][1];
            const transformedProcessed: Record<string, any> = {};

            for (let ind = 0; ind < rawProcessed.length; ++ind) {
              if (ind % 2) {
                transformedProcessed[rawProcessed[ind - 1]] = JSON.parse(
                  rawProcessed[ind],
                );
              }
            }
            processed = transformedProcessed;
            break;
          }
          case 'failed': {
            failed = results[index][1];
            break;
          }
          case 'ignored': {
            ignoredCursor = results[index][1][0];

            const rawIgnored = results[index][1][1];
            const transformedIgnored: Record<string, any> = {};

            for (let ind = 0; ind < rawIgnored.length; ++ind) {
              if (ind % 2) {
                transformedIgnored[rawIgnored[ind - 1]] = rawIgnored[ind];
              }
            }
            ignored = transformedIgnored;
            break;
          }
          case 'unprocessed': {
            unprocessedCursor = results[index][1][0];
            unprocessed = results[index][1][1];
            break;
          }
        }
      });

      return {
        ...(processedCursor
          ? {
              processed,
              nextProcessedCursor: Number(processedCursor),
            }
          : {}),
        ...(ignoredCursor
          ? {
              ignored,
              nextIgnoredCursor: Number(ignoredCursor),
            }
          : {}),
        ...(failedCursor
          ? {
              failed,
              nextFailedCursor: failedCursor,
            }
          : {}),
        ...(unprocessedCursor
          ? { unprocessed, nextUnprocessedCursor: Number(unprocessedCursor) }
          : {}),
      };
    }
  }

  // ============================================================
  // Promoted queue metadata & maintenance keys (previously direct
  // client calls in Queue / Worker)
  // ============================================================

  async setQueueMeta(values: Record<string, string | number>): Promise<number> {
    const client = await this.queue.client;
    return client.hset(this.queue.keys.meta, values);
  }

  async getQueueMetaField(field: string): Promise<string | null> {
    const client = await this.queue.client;
    return client.hget(this.queue.keys.meta, field);
  }

  async getQueueMetaFields(fields: string[]): Promise<(string | null)[]> {
    const client = await this.queue.client;
    return client.hmget(this.queue.keys.meta, ...fields);
  }

  async getQueueMeta(): Promise<Record<string, string>> {
    const client = await this.queue.client;
    return client.hgetall(this.queue.keys.meta);
  }

  async removeQueueMetaFields(fields: string[]): Promise<number> {
    const client = await this.queue.client;
    return client.hdel(this.queue.keys.meta, ...fields);
  }

  async hasQueueMetaField(field: string): Promise<boolean> {
    const client = await this.queue.client;
    const exists = await client.hexists(this.queue.keys.meta, field);
    return exists === 1;
  }

  async setRateLimit(expireTimeMs: number): Promise<void> {
    const client = await this.queue.client;
    await client.set(this.queue.keys.limiter, Number.MAX_SAFE_INTEGER, {
      PX: expireTimeMs,
    });
  }

  async removeRateLimitKey(): Promise<number> {
    const client = await this.queue.client;
    return client.del(this.queue.keys.limiter);
  }

  async removeDeprecatedPriorityKey(): Promise<number> {
    const client = await this.queue.client;
    return client.del(this.queue.toKey('priority'));
  }

  async deleteDeduplicationKey(deduplicationId: string): Promise<number> {
    const client = await this.queue.client;
    return client.del(`${this.queue.keys.de}:${deduplicationId}`);
  }

  async trimEvents(maxLength: number): Promise<number> {
    const client = await this.queue.client;
    return client.xtrim(this.queue.keys.events, 'MAXLEN', maxLength, {
      approximate: true,
    });
  }

  // ============================================================
  // Worker blocking primitive (previously bzpopmin in Worker)
  // ============================================================

  async waitForJob(
    blockTimeout: number,
  ): Promise<{ member: string; score: number } | null> {
    const conn = this.blockingConnection ?? this.connection;
    const bclient = (await this.queue.blockingClient)!;

    const roundedTimeout = conn.capabilities.canDoubleTimeout
      ? blockTimeout
      : Math.ceil(blockTimeout);

    // We cannot trust that the blocking connection stays blocking forever due
    // to issues in Redis and IORedis, so we reconnect the (owned) blocking
    // connection if we don't get a response within the expected time.
    const watchdog = setTimeout(
      () => {
        bclient.disconnect(!this.closing);
      },
      roundedTimeout * 1000 + 1000,
    );

    try {
      const result = await bclient.bzpopmin(
        this.queue.keys.marker,
        roundedTimeout,
      );
      if (result) {
        const [, member, score] = result;
        if (member) {
          return { member, score: parseInt(score) };
        }
      }
      return null;
    } finally {
      clearTimeout(watchdog);
    }
  }

  async publishEvent(
    fields: Record<string, string | number>,
    maxEvents: number,
  ): Promise<string> {
    const client = await this.queue.client;
    return client.xadd(this.queue.keys.events, '*', fields, {
      MAXLEN: maxEvents,
      approximate: true,
    });
  }

  async readEvents(id: string, blockTimeout: number): Promise<StreamReadRaw> {
    const client = await this.queue.client;
    return client.xread([{ key: this.queue.keys.events, id }], {
      BLOCK: blockTimeout,
    });
  }
}

export function raw2NextJobData(raw: any[]) {
  if (raw) {
    const result = [null, raw[1], raw[2], raw[3]];
    if (raw[0]) {
      result[0] = rawToJobJson(array2obj(raw[0]) as unknown as JobJsonRaw);
    }
    return result;
  }
  return [];
}

/**
 * A job hash as stored in Redis. Field names are abbreviated to save space and
 * all values are strings (Redis hashes only store strings). This shape is an
 * **internal detail of this (Redis) backend implementation** — it is
 * intentionally not exported nor part of any public type or interface. The
 * public, decoded representation is {@link JobJson}.
 */
interface JobJsonRaw {
  id: string;
  name: string;
  data: string;
  delay: string;
  opts: string;
  progress: string;
  attemptsMade?: string;
  finishedOn?: string;
  processedOn?: string;
  priority: string;
  timestamp: string;
  failedReason: string;
  stacktrace?: string;
  returnvalue: string;
  parentKey?: string;
  parent?: string;
  deid?: string;
  rjk?: string;
  nrjid?: string;
  atm?: string;
  defa?: string;
  stc?: string;
  ats?: string;
  pb?: string; // Worker name
}

/**
 * Decodes the compact, stored job options ({@link RedisJobOptions}, short keys)
 * back into their public form ({@link JobsOptions}). Internal to this backend.
 */
function optsFromJSON(
  rawOpts?: string,
  optsDecode: Record<string, string> = optsDecodeMap,
): JobsOptions {
  const opts = JSON.parse(rawOpts || '{}');

  const optionEntries = Object.entries(opts) as Array<[string, any]>;

  const options: Partial<Record<string, any>> = {};
  for (const item of optionEntries) {
    const [attributeName, value] = item;
    if ((optsDecode as Record<string, any>)[<string>attributeName]) {
      options[(optsDecode as Record<string, any>)[<string>attributeName]] =
        value;
    } else {
      if (attributeName === 'tm') {
        options.telemetry = { ...options.telemetry, metadata: value };
      } else if (attributeName === 'omc') {
        options.telemetry = { ...options.telemetry, omitContext: value };
      } else {
        options[<string>attributeName] = value;
      }
    }
  }

  return options as JobsOptions;
}

/**
 * Decodes a raw Redis job hash ({@link JobJsonRaw}) into the public, datastore
 * agnostic representation ({@link JobJson}). This translates the abbreviated
 * field names and numeric strings used in Redis back into their public
 * counterparts. Internal to this backend.
 *
 * Note: `data`, `stacktrace`, `returnvalue` and `failedReason` are kept as
 * their JSON-encoded string form, matching {@link Job.asJSON}.
 */
function rawToJobJson(raw: JobJsonRaw): JobJson {
  return {
    id: raw.id,
    name: raw.name,
    data: raw.data || '{}',
    opts: optsFromJSON(raw.opts),
    progress: JSON.parse(raw.progress || '0'),
    delay: parseInt(raw.delay),
    priority: parseInt(raw.priority),
    timestamp: parseInt(raw.timestamp),
    attemptsStarted: parseInt(raw.ats || '0'),
    attemptsMade: parseInt(raw.attemptsMade || raw.atm || '0'),
    stalledCounter: parseInt(raw.stc || '0'),
    finishedOn: raw.finishedOn ? parseInt(raw.finishedOn) : undefined,
    processedOn: raw.processedOn ? parseInt(raw.processedOn) : undefined,
    repeatJobKey: raw.rjk,
    debounceId: raw.deid,
    deduplicationId: raw.deid,
    failedReason: raw.failedReason,
    deferredFailure: raw.defa,
    stacktrace: raw.stacktrace,
    returnvalue: raw.returnvalue,
    parentKey: raw.parentKey,
    parent: raw.parent ? JSON.parse(raw.parent) : undefined,
    processedBy: raw.pb,
    nextSchedulerJobId: raw.nrjid,
  };
}

/**
 * Job options in their compact, stored form (short keys). This encoding exists
 * solely to reduce the number of bytes used to store options in Redis and is
 * therefore an **internal detail of this (Redis) backend implementation** — it
 * is intentionally not exported nor part of any public type or interface.
 */
type RedisJobOptions = BaseJobOptions & {
  deid?: string;
  fpof?: boolean;
  cpof?: boolean;
  idof?: boolean;
  kl?: number;
  rdof?: boolean;
  tm?: string;
  omc?: boolean;
  de?: DeduplicationOptions;
};

/**
 * Encodes public job options ({@link JobsOptions}) into their compact, stored
 * form (short keys) before they are packed and persisted in Redis. Internal to
 * this backend.
 */
function optsAsJSON(
  opts: JobsOptions = {},
  optsEncode: Record<string, string> = optsEncodeMap,
): RedisJobOptions {
  const optionEntries = Object.entries(opts) as Array<[keyof JobsOptions, any]>;
  const options: Record<string, any> = {};

  for (const [attributeName, value] of optionEntries) {
    if (typeof value === 'undefined') {
      continue;
    }
    if (attributeName in optsEncode) {
      const compressableAttribute = attributeName as keyof Omit<
        CompressableJobOptions,
        'debounce' | 'telemetry'
      >;

      const key = optsEncode[compressableAttribute];
      options[key] = value;
    } else {
      // Handle complex compressable fields separately
      if (attributeName === 'telemetry') {
        if (value.metadata !== undefined) {
          options.tm = value.metadata;
        }
        if (value.omitContext !== undefined) {
          options.omc = value.omitContext;
        }
      } else {
        options[attributeName] = value;
      }
    }
  }
  return options as RedisJobOptions;
}
