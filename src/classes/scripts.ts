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

import * as semver from 'semver';
import {
  JobJson,
  JobJsonRaw,
  JobsOptions,
  QueueSchedulerOptions,
  RedisClient,
  WorkerOptions,
  KeepJobs,
} from '../interfaces';
import { JobState, FinishedTarget, FinishedPropValAttribute } from '../types';
import { ErrorCode } from '../enums';
import { array2obj, getParentKey } from '../utils';
import { Worker } from './worker';
import { QueueScheduler } from './queue-scheduler';
import { QueueBase } from './queue-base';
import { Job, MoveToChildrenOpts } from './job';

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
  static async isJobInList(
    queue: MinimalQueue,
    listKey: string,
    jobId: string,
  ): Promise<boolean> {
    const client = await queue.client;
    let result;
    if (semver.lt(queue.redisVersion, '6.0.6')) {
      result = await (<any>client).isJobInList([listKey, jobId]);
    } else {
      result = await (<any>client).lpos(listKey, jobId);
    }
    return Number.isInteger(result);
  }

  static async addJob(
    client: RedisClient,
    queue: MinimalQueue,
    job: JobJson,
    opts: JobsOptions,
    jobId: string,
    parentOpts: ParentOpts = {
      parentKey: null,
      waitChildrenKey: null,
      parentDependenciesKey: null,
    },
  ): Promise<string> {
    const queueKeys = queue.keys;
    const keys: (string | Buffer)[] = [
      queueKeys.wait,
      queueKeys.paused,
      queueKeys.meta,
      queueKeys.id,
      queueKeys.delayed,
      queueKeys.priority,
      queueKeys.completed,
      queueKeys.events,
      queueKeys.delay,
    ];

    const args = [
      queueKeys[''],
      typeof jobId !== 'undefined' ? jobId : '',
      job.name,
      job.timestamp,
      parentOpts.parentKey || null,
      parentOpts.waitChildrenKey || null,
      parentOpts.parentDependenciesKey || null,
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

  static async pause(queue: MinimalQueue, pause: boolean): Promise<void> {
    const client = await queue.client;

    let src = 'wait',
      dst = 'paused';
    if (!pause) {
      src = 'paused';
      dst = 'wait';
    }

    const keys = [src, dst, 'meta'].map((name: string) => queue.toKey(name));

    keys.push(queue.keys.events);

    return (<any>client).pause(keys.concat([pause ? 'paused' : 'resumed']));
  }

  static removeRepeatableArgs(
    queue: MinimalQueue,
    repeatJobId: string,
    repeatJobKey: string,
  ): string[] {
    const queueKeys = queue.keys;

    const keys = [queueKeys.repeat, queueKeys.delayed];

    const args = [repeatJobId, repeatJobKey, queueKeys['']];

    return keys.concat(args);
  }

  static async removeRepeatable(
    queue: MinimalQueue,
    repeatJobId: string,
    repeatJobKey: string,
  ): Promise<void> {
    const client = await queue.client;
    const args = this.removeRepeatableArgs(queue, repeatJobId, repeatJobKey);

    return (<any>client).removeRepeatable(args);
  }

  static async remove(queue: MinimalQueue, jobId: string): Promise<number> {
    const client = await queue.client;

    const keys = [jobId].map(name => queue.toKey(name));
    return (<any>client).removeJob(keys.concat([jobId]));
  }

  static async extendLock(
    queue: MinimalQueue,
    jobId: string,
    token: string,
    duration: number,
  ): Promise<number> {
    const client = await queue.client;
    const args = [
      queue.toKey(jobId) + ':lock',
      queue.keys.stalled,
      token,
      duration,
      jobId,
    ];
    return (<any>client).extendLock(args);
  }

  static async updateProgress<T = any, R = any, N extends string = string>(
    queue: MinimalQueue,
    job: Job<T, R, N>,
    progress: number | object,
  ): Promise<void> {
    const client = await queue.client;

    const keys = [queue.toKey(job.id), queue.keys.events];
    const progressJson = JSON.stringify(progress);

    const result = await (<any>client).updateProgress(keys, [
      job.id,
      progressJson,
    ]);

    if (result < 0) {
      throw this.finishedErrors(result, job.id, 'updateProgress');
    }

    queue.emit('progress', job, progress);
  }

  static moveToFinishedArgs<T = any, R = any, N extends string = string>(
    queue: MinimalQueue,
    job: Job<T, R, N>,
    val: any,
    propVal: FinishedPropValAttribute,
    shouldRemove: boolean | number | KeepJobs,
    target: FinishedTarget,
    token: string,
    fetchNext = true,
  ) {
    const queueKeys = queue.keys;
    const opts: WorkerOptions = <WorkerOptions>queue.opts;

    const keys = [
      queueKeys.active,
      queueKeys[target],
      queue.toKey(job.id),
      queueKeys.wait,
      queueKeys.priority,
      queueKeys.events,
      queueKeys.meta,
      queueKeys.stalled,
    ];

    const keepJobs = pack(
      typeof shouldRemove === 'object'
        ? shouldRemove
        : typeof shouldRemove === 'number'
        ? { count: shouldRemove }
        : { count: shouldRemove ? 0 : -1 },
    );

    const args = [
      job.id,
      Date.now(),
      propVal,
      typeof val === 'undefined' ? 'null' : val,
      target,
      keepJobs,
      JSON.stringify({ jobId: job.id, val: val }),
      !fetchNext || queue.closing || opts.limiter ? 0 : 1,
      queueKeys[''],
      token,
      opts.lockDuration,
      job.opts?.parent?.id,
      job.opts?.parent?.queue,
      job.parentKey,
      job.opts.attempts,
      job.attemptsMade,
    ];

    return keys.concat(args);
  }

  private static async moveToFinished<
    DataType = any,
    ReturnType = any,
    NameType extends string = string,
  >(
    queue: MinimalQueue,
    job: Job<DataType, ReturnType, NameType>,
    val: any,
    propVal: FinishedPropValAttribute,
    shouldRemove: boolean | number | KeepJobs,
    target: FinishedTarget,
    token: string,
    fetchNext: boolean,
  ): Promise<JobData | []> {
    const client = await queue.client;

    const args = this.moveToFinishedArgs<DataType, ReturnType, NameType>(
      queue,
      job,
      val,
      propVal,
      shouldRemove,
      target,
      token,
      fetchNext,
    );

    const result = await (<any>client).moveToFinished(args);
    if (result < 0) {
      throw this.finishedErrors(result, job.id, 'finished', 'active');
    } else if (result) {
      return raw2jobData(result);
    }
  }

  static finishedErrors(
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
    }
  }

  static drainArgs(queue: MinimalQueue, delayed: boolean): string[] {
    const queueKeys = queue.keys;

    const keys = [
      queueKeys.wait,
      queueKeys.paused,
      delayed ? queueKeys.delayed : '',
      queueKeys.priority,
    ];

    const args = [queueKeys['']];

    return keys.concat(args);
  }

  static async drain(queue: MinimalQueue, delayed: boolean): Promise<void> {
    const client = await queue.client;
    const args = this.drainArgs(queue, delayed);

    return (<any>client).drain(args);
  }

  static moveToCompleted<T = any, R = any, N extends string = string>(
    queue: MinimalQueue,
    job: Job<T, R, N>,
    returnvalue: any,
    removeOnComplete: boolean | number | KeepJobs,
    token: string,
    fetchNext: boolean,
  ): Promise<JobData | []> {
    return this.moveToFinished<T, R, N>(
      queue,
      job,
      returnvalue,
      'returnvalue',
      removeOnComplete,
      'completed',
      token,
      fetchNext,
    );
  }

  static moveToFailedArgs<T = any, R = any, N extends string = string>(
    queue: MinimalQueue,
    job: Job<T, R, N>,
    failedReason: string,
    removeOnFailed: boolean | number | KeepJobs,
    token: string,
    fetchNext = false,
    retriesExhausted = 0,
  ) {
    return this.moveToFinishedArgs(
      queue,
      job,
      failedReason,
      'failedReason',
      removeOnFailed,
      'failed',
      token,
      fetchNext,
    );
  }

  static async isFinished(
    queue: MinimalQueue,
    jobId: string,
    returnValue = false,
  ): Promise<number | [number, string]> {
    const client = await queue.client;

    const keys = ['completed', 'failed', jobId].map(function (key: string) {
      return queue.toKey(key);
    });

    return (<any>client).isFinished(
      keys.concat([jobId, returnValue ? '1' : '']),
    );
  }

  static async getState(
    queue: MinimalQueue,
    jobId: string,
  ): Promise<JobState | 'unknown'> {
    const client = await queue.client;

    const keys = [
      'completed',
      'failed',
      'delayed',
      'active',
      'wait',
      'paused',
      'waiting-children',
    ].map(function (key: string) {
      return queue.toKey(key);
    });

    if (semver.lt(queue.redisVersion, '6.0.6')) {
      return (<any>client).getState(keys.concat([jobId]));
    }
    return (<any>client).getStateV2(keys.concat([jobId]));
  }

  static async changeDelay(
    queue: MinimalQueue,
    jobId: string,
    delay: number,
  ): Promise<void> {
    const client = await queue.client;

    const delayTimestamp = Date.now() + delay;
    const args = this.changeDelayArgs(queue, jobId, delayTimestamp);
    const result = await (<any>client).changeDelay(args);
    if (result < 0) {
      throw this.finishedErrors(result, jobId, 'changeDelay', 'delayed');
    }
  }

  static changeDelayArgs(
    queue: MinimalQueue,
    jobId: string,
    timestamp: number,
  ): string[] {
    //
    // Bake in the job id first 12 bits into the timestamp
    // to guarantee correct execution order of delayed jobs
    // (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
    //
    // WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
    //
    timestamp = Math.max(0, timestamp);

    if (timestamp > 0) {
      timestamp = timestamp * 0x1000 + (+jobId & 0xfff);
    }

    const keys = ['delayed', jobId].map(function (name) {
      return queue.toKey(name);
    });
    keys.push.apply(keys, [queue.keys.events, queue.keys.delay]);

    return keys.concat([JSON.stringify(timestamp), jobId]);
  }

  // Note: We have an issue here with jobs using custom job ids
  static moveToDelayedArgs(
    queue: MinimalQueue,
    jobId: string,
    timestamp: number,
  ): string[] {
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

    const keys = ['active', 'delayed', jobId].map(function (name) {
      return queue.toKey(name);
    });
    keys.push.apply(keys, [queue.keys.events, queue.keys.delay]);

    return keys.concat([JSON.stringify(timestamp), jobId]);
  }

  static moveToWaitingChildrenArgs(
    queue: MinimalQueue,
    jobId: string,
    token: string,
    opts?: MoveToChildrenOpts,
  ): string[] {
    let timestamp = Math.max(0, opts.timestamp ?? 0);

    const childKey = getParentKey(opts.child);

    if (timestamp > 0) {
      timestamp = timestamp * 0x1000 + (+jobId & 0xfff);
    }

    const keys = [`${jobId}:lock`, 'active', 'waiting-children', jobId].map(
      function (name) {
        return queue.toKey(name);
      },
    );

    return keys.concat([
      token,
      childKey ?? '',
      JSON.stringify(timestamp),
      jobId,
    ]);
  }

  static async moveToDelayed(
    queue: MinimalQueue,
    jobId: string,
    timestamp: number,
  ): Promise<void> {
    const client = await queue.client;

    const args = this.moveToDelayedArgs(queue, jobId, timestamp);
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
  static async moveToWaitingChildren(
    queue: MinimalQueue,
    jobId: string,
    token: string,
    opts: MoveToChildrenOpts = {},
  ): Promise<boolean> {
    const client = await queue.client;
    const multi = client.multi();

    const args = this.moveToWaitingChildrenArgs(queue, jobId, token, opts);
    (<any>multi).moveToWaitingChildren(args);
    const [[err, result]] = (await multi.exec()) as [[null | Error, number]];

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
  static async cleanJobsInSet(
    queue: MinimalQueue,
    set: string,
    timestamp: number,
    limit = 0,
  ): Promise<string[]> {
    const client = await queue.client;

    return (<any>client).cleanJobsInSet([
      queue.toKey(set),
      queue.toKey('events'),
      queue.toKey(''),
      timestamp,
      limit,
      set,
    ]);
  }

  static retryJobArgs<T = any, R = any, N extends string = string>(
    queue: MinimalQueue,
    job: Job<T, R, N>,
  ): string[] {
    const jobId = job.id;

    const keys = ['active', 'wait', jobId].map(function (name) {
      return queue.toKey(name);
    });

    keys.push(queue.keys.events);

    const pushCmd = (job.opts.lifo ? 'R' : 'L') + 'PUSH';

    return keys.concat([pushCmd, jobId]);
  }

  /**
   * Attempts to reprocess a job
   *
   * @param job -
   * @param {Object} options
   * @param {String} options.state The expected job state. If the job is not found
   * on the provided state, then it's not reprocessed. Supported states: 'failed', 'completed'
   *
   * @returns Returns a promise that evaluates to a return code:
   * 1 means the operation was a success
   * 0 means the job does not exist
   * -1 means the job is currently locked and can't be retried.
   * -2 means the job was not found in the expected set
   */
  static async reprocessJob<T = any, R = any, N extends string = string>(
    queue: MinimalQueue,
    job: Job<T, R, N>,
    state: 'failed' | 'completed',
  ): Promise<void> {
    const client = await queue.client;

    const keys = [
      queue.toKey(job.id),
      queue.keys.events,
      queue.toKey(state),
      queue.toKey('wait'),
    ];

    const args = [
      job.id,
      (job.opts.lifo ? 'R' : 'L') + 'PUSH',
      state === 'failed' ? 'failedReason' : 'returnvalue',
    ];

    const result = await (<any>client).reprocessJob(keys.concat(args));

    switch (result) {
      case 1:
        return;
      default:
        throw this.finishedErrors(result, job.id, 'reprocessJob', state);
    }
  }

  static async moveToActive<T, R, N extends string>(
    worker: Worker<T, R, N>,
    token: string,
    jobId?: string,
  ) {
    const client = await worker.client;
    const opts = worker.opts;

    const queueKeys = worker.keys;
    const keys = [
      queueKeys.wait,
      queueKeys.active,
      queueKeys.priority,
      queueKeys.events,
      queueKeys.stalled,
      queueKeys.limiter,
      queueKeys.delayed,
      queueKeys.delay,
    ];

    const args: (string | number | boolean)[] = [
      queueKeys[''],
      token,
      opts.lockDuration,
      Date.now(),
      jobId,
    ];

    if (opts.limiter) {
      args.push(opts.limiter.max, opts.limiter.duration);
      opts.limiter.groupKey && args.push(true);
    }

    const result = await (<any>client).moveToActive(
      (<(string | number | boolean)[]>keys).concat(args),
    );

    if (typeof result === 'number') {
      return [result, void 0] as [number, undefined];
    }
    return raw2jobData(result);
  }

  /**
   * It checks if the job in the top of the delay set should be moved back to the
   * top of the  wait queue (so that it will be processed as soon as possible)
   */
  static async updateDelaySet(queue: MinimalQueue, delayedTimestamp: number) {
    const client = await queue.client;

    const keys: (string | number)[] = [
      queue.keys.delayed,
      queue.keys.wait,
      queue.keys.priority,
      queue.keys.paused,
      queue.keys.meta,
      queue.keys.events,
      queue.keys.delay,
    ];

    const args = [queue.toKey(''), delayedTimestamp];

    return (<any>client).updateDelaySet(keys.concat(args));
  }

  static async promote(queue: MinimalQueue, jobId: string): Promise<number> {
    const client = await queue.client;

    const keys = [
      queue.keys.delayed,
      queue.keys.wait,
      queue.keys.paused,
      queue.keys.priority,
      queue.keys.events,
    ];

    const args = [queue.toKey(''), jobId];

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
  static async moveStalledJobsToWait(queue: QueueScheduler) {
    const client = await queue.client;

    const opts = queue.opts as QueueSchedulerOptions;
    const keys: (string | number)[] = [
      queue.keys.stalled,
      queue.keys.wait,
      queue.keys.active,
      queue.keys.failed,
      queue.keys['stalled-check'],
      queue.keys.meta,
      queue.keys.paused,
      queue.keys.events,
    ];
    const args = [
      opts.maxStalledCount,
      queue.toKey(''),
      Date.now(),
      opts.stalledInterval,
    ];
    return (<any>client).moveStalledJobsToWait(keys.concat(args));
  }

  static async obliterate(
    queue: MinimalQueue,
    opts: { force: boolean; count: number },
  ): Promise<number> {
    const client = await queue.client;

    const keys: (string | number)[] = [queue.keys.meta, queue.toKey('')];
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

export function raw2jobData(raw: any[]): [JobJsonRaw | number, string?] | [] {
  if (typeof raw === 'number') {
    return [raw, void 0] as [number, undefined];
  }
  if (raw) {
    const jobData = raw[0];
    if (jobData.length) {
      const job: any = array2obj(jobData);
      return [job, raw[1]];
    }
  }
  return [];
}
