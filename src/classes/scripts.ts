/**
 * Includes all the scripts needed by the queue and jobs.
 */

/*eslint-env node */
'use strict';
import { Packr } from 'msgpackr';

const packer = new Packr({
  useRecords: false,
  encodeUndefinedAsNil: true,
});

const pack = packer.pack;

import {
  JobJson,
  JobJsonRaw,
  RedisClient,
  WorkerOptions,
  KeepJobs,
} from '../interfaces';
import {
  JobState,
  JobType,
  FinishedStatus,
  FinishedPropValAttribute,
  RedisJobOptions,
} from '../types';
import { ErrorCode } from '../enums';
import { array2obj, getParentKey, isRedisVersionLowerThan } from '../utils';
import { QueueBase } from './queue-base';
import { Job, MoveToWaitingChildrenOpts } from './job';
import { ChainableCommander } from 'ioredis';

export type MinimalQueue = Pick<
  QueueBase,
  | 'name'
  | 'client'
  | 'toKey'
  | 'keys'
  | 'opts'
  | 'closing'
  | 'waitUntilReady'
  | 'removeListener'
  | 'emit'
  | 'on'
  | 'redisVersion'
>;

export type ParentOpts = {
  waitChildrenKey?: string;
  parentDependenciesKey?: string;
  parentKey?: string;
};

export type JobData = [JobJsonRaw | number, string?];

export class Scripts {
  constructor(protected queue: MinimalQueue) {}

  async isJobInList(listKey: string, jobId: string): Promise<boolean> {
    const client = await this.queue.client;
    let result;
    if (isRedisVersionLowerThan(this.queue.redisVersion, '6.0.6')) {
      result = await (<any>client).isJobInList([listKey, jobId]);
    } else {
      result = await (<any>client).lpos(listKey, jobId);
    }
    return Number.isInteger(result);
  }

  async addJob(
    client: RedisClient,
    job: JobJson,
    opts: RedisJobOptions,
    jobId: string,
    parentOpts: ParentOpts = {
      parentKey: null,
      waitChildrenKey: null,
      parentDependenciesKey: null,
    },
  ): Promise<string> {
    const queueKeys = this.queue.keys;
    const keys: (string | Buffer)[] = [
      queueKeys.wait,
      queueKeys.paused,
      queueKeys.meta,
      queueKeys.id,
      queueKeys.delayed,
      queueKeys.priority,
      queueKeys.completed,
      queueKeys.events,
    ];

    const fpof = opts.fpof ? { fpof: true } : {};
    const parent = job.parent ? { ...job.parent, ...fpof } : null;

    const args = [
      queueKeys[''],
      typeof jobId !== 'undefined' ? jobId : '',
      job.name,
      job.timestamp,
      job.parentKey || null,
      parentOpts.waitChildrenKey || null,
      parentOpts.parentDependenciesKey || null,
      parent,
      job.repeatJobKey,
    ];

    let encodedOpts;
    if (opts.repeat) {
      const repeat = {
        ...opts.repeat,
      };

      if (repeat.startDate) {
        repeat.startDate = +new Date(repeat.startDate);
      }
      if (repeat.endDate) {
        repeat.endDate = +new Date(repeat.endDate);
      }

      encodedOpts = pack({
        ...opts,
        repeat,
      });
    } else {
      encodedOpts = pack(opts);
    }

    keys.push(pack(args), job.data, encodedOpts);

    const result = await (<any>client).addJob(keys);

    if (result < 0) {
      throw this.finishedErrors(result, parentOpts.parentKey, 'addJob');
    }

    return result;
  }

  async pause(pause: boolean): Promise<void> {
    const client = await this.queue.client;

    let src = 'wait',
      dst = 'paused';
    if (!pause) {
      src = 'paused';
      dst = 'wait';
    }

    const keys = [src, dst, 'meta'].map((name: string) =>
      this.queue.toKey(name),
    );

    keys.push(this.queue.keys.events);

    return (<any>client).pause(keys.concat([pause ? 'paused' : 'resumed']));
  }

  private removeRepeatableArgs(
    repeatJobId: string,
    repeatJobKey: string,
  ): string[] {
    const queueKeys = this.queue.keys;

    const keys = [queueKeys.repeat, queueKeys.delayed];

    const args = [repeatJobId, repeatJobKey, queueKeys['']];

    return keys.concat(args);
  }

  async removeRepeatable(
    repeatJobId: string,
    repeatJobKey: string,
  ): Promise<number> {
    const client = await this.queue.client;
    const args = this.removeRepeatableArgs(repeatJobId, repeatJobKey);

    return (<any>client).removeRepeatable(args);
  }

  async remove(jobId: string): Promise<number> {
    const client = await this.queue.client;

    const keys = [''].map(name => this.queue.toKey(name));
    return (<any>client).removeJob(keys.concat([jobId]));
  }

  async extendLock(
    jobId: string,
    token: string,
    duration: number,
  ): Promise<number> {
    const client = await this.queue.client;
    const args = [
      this.queue.toKey(jobId) + ':lock',
      this.queue.keys.stalled,
      token,
      duration,
      jobId,
    ];
    return (<any>client).extendLock(args);
  }

  async updateData<T = any, R = any, N extends string = string>(
    job: Job<T, R, N>,
    data: T,
  ): Promise<void> {
    const client = await this.queue.client;

    const keys = [this.queue.toKey(job.id)];
    const dataJson = JSON.stringify(data);

    const result = await (<any>client).updateData(keys.concat([dataJson]));

    if (result < 0) {
      throw this.finishedErrors(result, job.id, 'updateData');
    }
  }

  async updateProgress<T = any, R = any, N extends string = string>(
    job: Job<T, R, N>,
    progress: number | object,
  ): Promise<void> {
    const client = await this.queue.client;

    const keys = [this.queue.toKey(job.id), this.queue.keys.events];
    const progressJson = JSON.stringify(progress);

    const result = await (<any>client).updateProgress(
      keys.concat([job.id, progressJson]),
    );

    if (result < 0) {
      throw this.finishedErrors(result, job.id, 'updateProgress');
    }

    this.queue.emit('progress', job, progress);
  }

  protected moveToFinishedArgs<T = any, R = any, N extends string = string>(
    job: Job<T, R, N>,
    val: any,
    propVal: FinishedPropValAttribute,
    shouldRemove: boolean | number | KeepJobs,
    target: FinishedStatus,
    token: string,
    timestamp: number,
    fetchNext = true,
  ): (string | number | boolean | Buffer)[] {
    const queueKeys = this.queue.keys;
    const opts: WorkerOptions = <WorkerOptions>this.queue.opts;

    const metricsKey = this.queue.toKey(`metrics:${target}`);

    const keys = [
      queueKeys.wait,
      queueKeys.active,
      queueKeys.priority,
      queueKeys.events,
      queueKeys.stalled,
      queueKeys.limiter,
      queueKeys.delayed,
      queueKeys.paused,
      queueKeys[target],
      this.queue.toKey(job.id),
      queueKeys.meta,
      metricsKey,
    ];

    const keepJobs =
      typeof shouldRemove === 'object'
        ? shouldRemove
        : typeof shouldRemove === 'number'
        ? { count: shouldRemove }
        : { count: shouldRemove ? 0 : -1 };

    const args = [
      job.id,
      timestamp,
      propVal,
      typeof val === 'undefined' ? 'null' : val,
      target,
      JSON.stringify({ jobId: job.id, val: val }),
      !fetchNext || this.queue.closing ? 0 : 1,
      queueKeys[''],
      pack({
        token,
        keepJobs,
        limiter: opts.limiter,
        lockDuration: opts.lockDuration,
        parent: job.opts?.parent,
        parentKey: job.parentKey,
        attempts: job.opts.attempts,
        attemptsMade: job.attemptsMade,
        maxMetricsSize: opts.metrics?.maxDataPoints
          ? opts.metrics?.maxDataPoints
          : '',
        fpof: !!job.opts?.failParentOnFailure,
      }),
    ];

    return keys.concat(args);
  }

  protected async moveToFinished<
    DataType = any,
    ReturnType = any,
    NameType extends string = string,
  >(
    job: Job<DataType, ReturnType, NameType>,
    val: any,
    propVal: FinishedPropValAttribute,
    shouldRemove: boolean | number | KeepJobs,
    target: FinishedStatus,
    token: string,
    fetchNext: boolean,
  ) {
    const client = await this.queue.client;

    const timestamp = Date.now();
    const args = this.moveToFinishedArgs<DataType, ReturnType, NameType>(
      job,
      val,
      propVal,
      shouldRemove,
      target,
      token,
      timestamp,
      fetchNext,
    );

    const result = await (<any>client).moveToFinished(args);
    if (result < 0) {
      throw this.finishedErrors(result, job.id, 'finished', 'active');
    } else {
      job.finishedOn = timestamp;

      if (typeof result !== 'undefined') {
        return raw2NextJobData(result);
      }
    }
  }

  finishedErrors(
    code: number,
    jobId: string,
    command: string,
    state?: string,
  ): Error {
    switch (code) {
      case ErrorCode.JobNotExist:
        return new Error(`Missing key for job ${jobId}. ${command}`);
      case ErrorCode.JobLockNotExist:
        return new Error(`Missing lock for job ${jobId}. ${command}`);
      case ErrorCode.JobNotInState:
        return new Error(
          `Job ${jobId} is not in the ${state} state. ${command}`,
        );
      case ErrorCode.JobPendingDependencies:
        return new Error(`Job ${jobId} has pending dependencies. ${command}`);
      case ErrorCode.ParentJobNotExist:
        return new Error(`Missing key for parent job ${jobId}. ${command}`);
      case ErrorCode.JobLockMismatch:
        return new Error(
          `Lock mismatch for job ${jobId}. Cmd ${command} from ${state}`,
        );
      default:
        return new Error(`Unknown code ${code} error for ${jobId}. ${command}`);
    }
  }

  private drainArgs(delayed: boolean): (string | number)[] {
    const queueKeys = this.queue.keys;

    const keys: (string | number)[] = [
      queueKeys.wait,
      queueKeys.paused,
      delayed ? queueKeys.delayed : '',
      queueKeys.priority,
    ];

    const args = [queueKeys['']];

    return keys.concat(args);
  }

  async drain(delayed: boolean): Promise<void> {
    const client = await this.queue.client;
    const args = this.drainArgs(delayed);

    return (<any>client).drain(args);
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

    return (<any>client).getRanges(args);
  }

  moveToCompleted<T = any, R = any, N extends string = string>(
    job: Job<T, R, N>,
    returnvalue: R,
    removeOnComplete: boolean | number | KeepJobs,
    token: string,
    fetchNext: boolean,
  ) {
    return this.moveToFinished<T, R, N>(
      job,
      returnvalue,
      'returnvalue',
      removeOnComplete,
      'completed',
      token,
      fetchNext,
    );
  }

  moveToFailedArgs<T = any, R = any, N extends string = string>(
    job: Job<T, R, N>,
    failedReason: string,
    removeOnFailed: boolean | number | KeepJobs,
    token: string,
    fetchNext = false,
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

    return (<any>client).isFinished(
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
    ].map((key: string) => {
      return this.queue.toKey(key);
    });

    if (isRedisVersionLowerThan(this.queue.redisVersion, '6.0.6')) {
      return (<any>client).getState(keys.concat([jobId]));
    }
    return (<any>client).getStateV2(keys.concat([jobId]));
  }

  async changeDelay(jobId: string, delay: number): Promise<void> {
    const client = await this.queue.client;

    const args = this.changeDelayArgs(jobId, delay);
    const result = await (<any>client).changeDelay(args);
    if (result < 0) {
      throw this.finishedErrors(result, jobId, 'changeDelay', 'delayed');
    }
  }

  private changeDelayArgs(jobId: string, delay: number): (string | number)[] {
    //
    // Bake in the job id first 12 bits into the timestamp
    // to guarantee correct execution order of delayed jobs
    // (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
    //
    // WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
    //
    let timestamp = Date.now() + delay;

    if (timestamp > 0) {
      timestamp = timestamp * 0x1000 + (+jobId & 0xfff);
    }

    const keys: (string | number)[] = ['delayed', jobId].map(name => {
      return this.queue.toKey(name);
    });
    keys.push.apply(keys, [this.queue.keys.events]);

    return keys.concat([delay, JSON.stringify(timestamp), jobId]);
  }

  // Note: We have an issue here with jobs using custom job ids
  moveToDelayedArgs(
    jobId: string,
    timestamp: number,
    token: string,
  ): (string | number)[] {
    //
    // Bake in the job id first 12 bits into the timestamp
    // to guarantee correct execution order of delayed jobs
    // (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
    //
    // WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
    //
    timestamp = Math.max(0, timestamp ?? 0);

    if (timestamp > 0) {
      timestamp = timestamp * 0x1000 + (+jobId & 0xfff);
    }

    const keys: (string | number)[] = [
      'wait',
      'active',
      'priority',
      'delayed',
      jobId,
    ].map(name => {
      return this.queue.toKey(name);
    });
    keys.push.apply(keys, [
      this.queue.keys.events,
      this.queue.keys.paused,
      this.queue.keys.meta,
    ]);

    return keys.concat([
      this.queue.keys[''],
      Date.now(),
      JSON.stringify(timestamp),
      jobId,
      token,
    ]);
  }

  moveToWaitingChildrenArgs(
    jobId: string,
    token: string,
    opts?: MoveToWaitingChildrenOpts,
  ): string[] {
    const timestamp = Date.now();

    const childKey = getParentKey(opts.child);

    const keys = [`${jobId}:lock`, 'active', 'waiting-children', jobId].map(
      name => {
        return this.queue.toKey(name);
      },
    );

    return keys.concat([
      token,
      childKey ?? '',
      JSON.stringify(timestamp),
      jobId,
    ]);
  }

  async moveToDelayed(
    jobId: string,
    timestamp: number,
    token = '0',
  ): Promise<void> {
    const client = await this.queue.client;

    const args = this.moveToDelayedArgs(jobId, timestamp, token);
    const result = await (<any>client).moveToDelayed(args);
    if (result < 0) {
      throw this.finishedErrors(result, jobId, 'moveToDelayed', 'active');
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
    const result = await (<any>client).moveToWaitingChildren(args);

    switch (result) {
      case 0:
        return true;
      case 1:
        return false;
      default:
        throw this.finishedErrors(
          result,
          jobId,
          'moveToWaitingChildren',
          'active',
        );
    }
  }

  /**
   * Remove jobs in a specific state.
   *
   * @returns Id jobs from the deleted records.
   */
  async cleanJobsInSet(
    set: string,
    timestamp: number,
    limit = 0,
  ): Promise<string[]> {
    const client = await this.queue.client;

    return (<any>client).cleanJobsInSet([
      this.queue.toKey(set),
      this.queue.toKey('events'),
      this.queue.toKey(''),
      timestamp,
      limit,
      set,
    ]);
  }

  retryJobArgs(
    jobId: string,
    lifo: boolean,
    token: string,
  ): (string | number)[] {
    const keys: (string | number)[] = [
      'active',
      'wait',
      'paused',
      jobId,
      'meta',
    ].map(name => {
      return this.queue.toKey(name);
    });

    keys.push(
      this.queue.keys.events,
      this.queue.keys.delayed,
      this.queue.keys.priority,
    );

    const pushCmd = (lifo ? 'R' : 'L') + 'PUSH';

    return keys.concat([
      this.queue.toKey(''),
      Date.now(),
      pushCmd,
      jobId,
      token,
    ]);
  }

  protected retryJobsArgs(
    state: FinishedStatus,
    count: number,
    timestamp: number,
  ): (string | number)[] {
    const keys: (string | number)[] = [
      this.queue.toKey(''),
      this.queue.keys.events,
      this.queue.toKey(state),
      this.queue.toKey('wait'),
      this.queue.toKey('paused'),
      this.queue.toKey('meta'),
    ];

    const args = [count, timestamp, state];

    return keys.concat(args);
  }

  async retryJobs(
    state: FinishedStatus = 'failed',
    count = 1000,
    timestamp = new Date().getTime(),
  ): Promise<number> {
    const client = await this.queue.client;

    const args = this.retryJobsArgs(state, count, timestamp);

    return (<any>client).retryJobs(args);
  }

  /**
   * Attempts to reprocess a job
   *
   * @param job -
   * @param state - The expected job state. If the job is not found
   * on the provided state, then it's not reprocessed. Supported states: 'failed', 'completed'
   *
   * @returns Returns a promise that evaluates to a return code:
   * 1 means the operation was a success
   * 0 means the job does not exist
   * -1 means the job is currently locked and can't be retried.
   * -2 means the job was not found in the expected set
   */
  async reprocessJob<T = any, R = any, N extends string = string>(
    job: Job<T, R, N>,
    state: 'failed' | 'completed',
  ): Promise<void> {
    const client = await this.queue.client;

    const keys = [
      this.queue.toKey(job.id),
      this.queue.keys.events,
      this.queue.toKey(state),
      this.queue.toKey('wait'),
    ];

    const args = [
      job.id,
      (job.opts.lifo ? 'R' : 'L') + 'PUSH',
      state === 'failed' ? 'failedReason' : 'returnvalue',
      state,
    ];

    const result = await (<any>client).reprocessJob(keys.concat(args));

    switch (result) {
      case 1:
        return;
      default:
        throw this.finishedErrors(result, job.id, 'reprocessJob', state);
    }
  }

  async moveToActive(token: string, jobId?: string) {
    const client = await this.queue.client;
    const opts = this.queue.opts as WorkerOptions;

    const queueKeys = this.queue.keys;
    const keys = [
      queueKeys.wait,
      queueKeys.active,
      queueKeys.priority,
      queueKeys.events,
      queueKeys.stalled,
      queueKeys.limiter,
      queueKeys.delayed,
      queueKeys.paused,
      queueKeys.meta,
    ];

    const args: (string | number | boolean | Buffer)[] = [
      queueKeys[''],
      Date.now(),
      jobId,
      pack({
        token,
        lockDuration: opts.lockDuration,
        limiter: opts.limiter,
      }),
    ];

    if (opts.limiter) {
      args.push(opts.limiter.max, opts.limiter.duration);
    }

    const result = await (<any>client).moveToActive(
      (<(string | number | boolean | Buffer)[]>keys).concat(args),
    );

    return raw2NextJobData(result);
  }

  async promote(jobId: string): Promise<number> {
    const client = await this.queue.client;

    const keys = [
      this.queue.keys.delayed,
      this.queue.keys.wait,
      this.queue.keys.paused,
      this.queue.keys.meta,
      this.queue.keys.priority,
      this.queue.keys.events,
    ];

    const args = [this.queue.toKey(''), jobId];

    return (<any>client).promote(keys.concat(args));
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
  async moveStalledJobsToWait(): Promise<[string[], string[]]> {
    const client = await this.queue.client;

    const opts = this.queue.opts as WorkerOptions;
    const keys: (string | number)[] = [
      this.queue.keys.stalled,
      this.queue.keys.wait,
      this.queue.keys.active,
      this.queue.keys.failed,
      this.queue.keys['stalled-check'],
      this.queue.keys.meta,
      this.queue.keys.paused,
      this.queue.keys.events,
    ];
    const args = [
      opts.maxStalledCount,
      this.queue.toKey(''),
      Date.now(),
      opts.stalledInterval,
    ];
    return (<any>client).moveStalledJobsToWait(keys.concat(args));
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
  moveJobFromActiveToWait(
    client: ChainableCommander,
    jobId: string,
    token: string,
  ) {
    const lockKey = `${this.queue.toKey(jobId)}:lock`;

    const keys = [
      this.queue.keys.active,
      this.queue.keys.wait,
      this.queue.keys.stalled,
      lockKey,
    ];

    const args = [jobId, token];

    return (<any>client).moveJobFromActiveToWait(keys.concat(args));
  }

  async obliterate(opts: { force: boolean; count: number }): Promise<number> {
    const client = await this.queue.client;

    const keys: (string | number)[] = [
      this.queue.keys.meta,
      this.queue.toKey(''),
    ];
    const args = [opts.count, opts.force ? 'force' : null];

    const result = await (<any>client).obliterate(keys.concat(args));
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

  /*
//   *
//    * Attempts to reprocess a job
//    *
//    * @param {Job} job
//    * @param {Object} options
//    * @param {String} options.state The expected job state. If the job is not found
//    * on the provided state, then it's not reprocessed. Supported states: 'failed', 'completed'
//    *
//    * @return {Promise<Number>} Returns a promise that evaluates to a return code:
//    * 1 means the operation was a success
//    * 0 means the job does not exist
//    * -1 means the job is currently locked and can't be retried.
//    * -2 means the job was not found in the expected set

  static reprocessJob(job: Jov, state: string) {
    var queue = job.queue;

    var keys = [
      queue.toKey(job.id),
      queue.toKey(job.id) + ':lock',
      queue.toKey(state),
      queue.toKey('wait'),
    ];

    var args = [job.id, (job.opts.lifo ? 'R' : 'L') + 'PUSH', queue.token];

    return queue.client.reprocessJob(keys.concat(args));
  }
  */
}

export function raw2NextJobData(raw: any[]) {
  if (raw) {
    const result = [null, raw[1], raw[2], raw[3]];
    if (raw[0]) {
      result[0] = array2obj(raw[0]);
    }
    return result;
  }
  return [];
}
