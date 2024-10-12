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
  MinimalJob,
  MoveToWaitingChildrenOpts,
  ParentOpts,
  RedisClient,
  WorkerOptions,
  KeepJobs,
  MoveToDelayedOpts,
  RepeatableOptions,
} from '../interfaces';
import {
  JobState,
  JobType,
  FinishedStatus,
  FinishedPropValAttribute,
  MinimalQueue,
  RedisJobOptions,
} from '../types';
import { ErrorCode } from '../enums';
import { array2obj, getParentKey, isRedisVersionLowerThan } from '../utils';
import { ChainableCommander } from 'ioredis';

export type JobData = [JobJsonRaw | number, string?];

export class Scripts {
  moveToFinishedKeys: (string | undefined)[];

  constructor(protected queue: MinimalQueue) {
    const queueKeys = this.queue.keys;

    this.moveToFinishedKeys = [
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
      undefined,
      undefined,
      undefined,
      undefined,
    ];
  }

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

  protected addDelayedJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    const queueKeys = this.queue.keys;
    const keys: (string | Buffer)[] = [
      queueKeys.marker,
      queueKeys.meta,
      queueKeys.id,
      queueKeys.delayed,
      queueKeys.completed,
      queueKeys.events,
    ];

    keys.push(pack(args), job.data, encodedOpts);

    return (<any>client).addDelayedJob(keys);
  }

  protected addPrioritizedJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    const queueKeys = this.queue.keys;
    const keys: (string | Buffer)[] = [
      queueKeys.marker,
      queueKeys.meta,
      queueKeys.id,
      queueKeys.prioritized,
      queueKeys.completed,
      queueKeys.active,
      queueKeys.events,
      queueKeys.pc,
    ];

    keys.push(pack(args), job.data, encodedOpts);

    return (<any>client).addPrioritizedJob(keys);
  }

  protected addParentJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    const queueKeys = this.queue.keys;
    const keys: (string | Buffer)[] = [
      queueKeys.meta,
      queueKeys.id,
      queueKeys.completed,
      queueKeys.events,
    ];

    keys.push(pack(args), job.data, encodedOpts);

    return (<any>client).addParentJob(keys);
  }

  protected addStandardJob(
    client: RedisClient,
    job: JobJson,
    encodedOpts: any,
    args: (string | number | Record<string, any>)[],
  ): Promise<string | number> {
    const queueKeys = this.queue.keys;
    const keys: (string | Buffer)[] = [
      queueKeys.wait,
      queueKeys.paused,
      queueKeys.meta,
      queueKeys.id,
      queueKeys.completed,
      queueKeys.active,
      queueKeys.events,
      queueKeys.marker,
    ];

    keys.push(pack(args), job.data, encodedOpts);

    return (<any>client).addStandardJob(keys);
  }

  async addJob(
    client: RedisClient,
    job: JobJson,
    opts: RedisJobOptions,
    jobId: string,
    parentOpts: ParentOpts = {},
  ): Promise<string> {
    const queueKeys = this.queue.keys;

    const parent: Record<string, any> = job.parent
      ? { ...job.parent, fpof: opts.fpof, rdof: opts.rdof, idof: opts.idof }
      : null;

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
      job.deduplicationId ? `${queueKeys.de}:${job.deduplicationId}` : null,
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

    let result: string | number;

    if (parentOpts.waitChildrenKey) {
      result = await this.addParentJob(client, job, encodedOpts, args);
    } else if (typeof opts.delay == 'number') {
      result = await this.addDelayedJob(client, job, encodedOpts, args);
    } else if (opts.priority) {
      result = await this.addPrioritizedJob(client, job, encodedOpts, args);
    } else {
      result = await this.addStandardJob(client, job, encodedOpts, args);
    }

    if (<number>result < 0) {
      throw this.finishedErrors({
        code: <number>result,
        parentKey: parentOpts.parentKey,
        command: 'addJob',
      });
    }

    return <string>result;
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

    return (<any>client).pause(args);
  }

  protected addRepeatableJobArgs(
    customKey: string,
    nextMillis: number,
    opts: RepeatableOptions,
    legacyCustomKey: string,
  ): (string | number | Buffer)[] {
    const queueKeys = this.queue.keys;
    const keys: (string | number | Buffer)[] = [
      queueKeys.repeat,
      queueKeys.delayed,
    ];

    const args = [
      nextMillis,
      pack(opts),
      legacyCustomKey,
      customKey,
      queueKeys[''],
    ];

    return keys.concat(args);
  }

  async addRepeatableJob(
    customKey: string,
    nextMillis: number,
    opts: RepeatableOptions,
    legacyCustomKey: string,
  ): Promise<string> {
    const client = await this.queue.client;

    const args = this.addRepeatableJobArgs(
      customKey,
      nextMillis,
      opts,
      legacyCustomKey,
    );

    return (<any>client).addRepeatableJob(args);
  }

  async addJobScheduler(
    jobSchedulerId: string,
    nextMillis: number,
    opts: RepeatableOptions,
  ): Promise<string> {
    const queueKeys = this.queue.keys;
    const client = await this.queue.client;

    const keys: (string | number | Buffer)[] = [
      queueKeys.repeat,
      queueKeys.delayed,
    ];
    const args = [nextMillis, pack(opts), jobSchedulerId, queueKeys['']];

    return (<any>client).addJobScheduler(keys.concat(args));
  }

  async updateRepeatableJobMillis(
    client: RedisClient,
    customKey: string,
    nextMillis: number,
    legacyCustomKey: string,
  ): Promise<string> {
    const args = [
      this.queue.keys.repeat,
      nextMillis,
      customKey,
      legacyCustomKey,
    ];
    return (<any>client).updateRepeatableJobMillis(args);
  }

  async updateJobSchedulerNextMillis(
    jobSchedulerId: string,
    nextMillis: number,
  ): Promise<number> {
    const client = await this.queue.client;

    return client.zadd(this.queue.keys.repeat, nextMillis, jobSchedulerId);
  }

  private removeRepeatableArgs(
    legacyRepeatJobId: string,
    repeatConcatOptions: string,
    repeatJobKey: string,
  ): string[] {
    const queueKeys = this.queue.keys;

    const keys = [queueKeys.repeat, queueKeys.delayed, queueKeys.events];

    const args = [
      legacyRepeatJobId,
      this.getRepeatConcatOptions(repeatConcatOptions, repeatJobKey),
      repeatJobKey,
      queueKeys[''],
    ];

    return keys.concat(args);
  }

  // TODO: remove this check in next breaking change
  getRepeatConcatOptions(repeatConcatOptions: string, repeatJobKey: string) {
    if (repeatJobKey && repeatJobKey.split(':').length > 2) {
      return repeatJobKey;
    }

    return repeatConcatOptions;
  }

  async removeRepeatable(
    legacyRepeatJobId: string,
    repeatConcatOptions: string,
    repeatJobKey: string,
  ): Promise<number> {
    const client = await this.queue.client;
    const args = this.removeRepeatableArgs(
      legacyRepeatJobId,
      repeatConcatOptions,
      repeatJobKey,
    );

    return (<any>client).removeRepeatable(args);
  }

  async removeJobScheduler(jobSchedulerId: string): Promise<number> {
    const client = await this.queue.client;

    const queueKeys = this.queue.keys;

    const keys = [queueKeys.repeat, queueKeys.delayed, queueKeys.events];

    const args = [jobSchedulerId, queueKeys['']];

    return (<any>client).removeJobScheduler(keys.concat(args));
  }

  protected removeArgs(jobId: string, removeChildren: boolean): (string | number)[] {
    const keys: (string | number)[] = ['', 'meta'].map(name =>
      this.queue.toKey(name),
    );
    
    const args = [jobId, removeChildren ? 1 : 0];

    return keys.concat(args);
  }

  async remove(jobId: string, removeChildren: boolean): Promise<number> {
    const client = await this.queue.client;

    const args = this.removeArgs(
      jobId, removeChildren
    );

    const result = await (<any>client).removeJob(
      args,
    );

    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'removeJob',
      });
    }

    return result;
  }

  async extendLock(
    jobId: string,
    token: string,
    duration: number,
    client?: RedisClient | ChainableCommander,
  ): Promise<number> {
    client = client || (await this.queue.client);
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
    job: MinimalJob<T, R, N>,
    data: T,
  ): Promise<void> {
    const client = await this.queue.client;

    const keys = [this.queue.toKey(job.id)];
    const dataJson = JSON.stringify(data);

    const result = await (<any>client).updateData(keys.concat([dataJson]));

    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId: job.id,
        command: 'updateData',
      });
    }
  }

  async updateProgress(
    jobId: string,
    progress: number | object,
  ): Promise<void> {
    const client = await this.queue.client;

    const keys = [
      this.queue.toKey(jobId),
      this.queue.keys.events,
      this.queue.keys.meta,
    ];
    const progressJson = JSON.stringify(progress);

    const result = await (<any>client).updateProgress(
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

    const result = await (<any>client).addLog(
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
        keepJobs,
        limiter: opts.limiter,
        lockDuration: opts.lockDuration,
        attempts: job.opts.attempts,
        maxMetricsSize: opts.metrics?.maxDataPoints
          ? opts.metrics?.maxDataPoints
          : '',
        fpof: !!job.opts?.failParentOnFailure,
        idof: !!job.opts?.ignoreDependencyOnFailure,
        rdof: !!job.opts?.removeDependencyOnFailure,
      }),
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

    const result = await (<any>client).moveToFinished(args);
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
        return new Error(`Missing key for parent job ${parentKey}. ${command}`);
      case ErrorCode.JobLockMismatch:
        return new Error(
          `Lock mismatch for job ${jobId}. Cmd ${command} from ${state}`,
        );
      case ErrorCode.ParentJobCannotBeReplaced:
        return new Error(
          `The parent job ${parentKey} cannot be replaced. ${command}`,
        );
      case ErrorCode.JobBelongsToJobScheduler:
        return new Error(
          `Job ${jobId} belongs to a job scheduler and cannot be removed directly. ${command}`,
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
      queueKeys.prioritized,
      queueKeys.repeat,
    ];

    const args = [queueKeys['']];

    return keys.concat(args);
  }

  async drain(delayed: boolean): Promise<void> {
    const client = await this.queue.client;
    const args = this.drainArgs(delayed);

    return (<any>client).drain(args);
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

    const result = await (<any>client).removeChildDependency(args);

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

    return (<any>client).getRanges(args);
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

    return (<any>client).getCounts(args);
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

    return (<any>client).getCountsPerPriority(args);
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
      'prioritized',
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
    const result = await (<any>client).changePriority(args);
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
  ): (string | number)[] {
    const queueKeys = this.queue.keys;
    const keys: (string | number)[] = [
      queueKeys.marker,
      queueKeys.active,
      queueKeys.prioritized,
      queueKeys.delayed,
      this.queue.toKey(jobId),
      queueKeys.events,
      queueKeys.meta,
      queueKeys.stalled,
    ];

    return keys.concat([
      this.queue.keys[''],
      timestamp,
      jobId,
      token,
      delay,
      opts.skipAttempt ? '1' : '0',
    ]);
  }

  saveStacktraceArgs(
    jobId: string,
    stacktrace: string,
    failedReason: string,
  ): string[] {
    const keys: string[] = [this.queue.toKey(jobId)];

    return keys.concat([stacktrace, failedReason]);
  }

  moveToWaitingChildrenArgs(
    jobId: string,
    token: string,
    opts?: MoveToWaitingChildrenOpts,
  ): (string | number)[] {
    const timestamp = Date.now();

    const childKey = getParentKey(opts.child);

    const keys: (string | number)[] = [
      `${jobId}:lock`,
      'active',
      'waiting-children',
      jobId,
      'stalled',
    ].map(name => {
      return this.queue.toKey(name);
    });

    return keys.concat([
      token,
      childKey ?? '',
      JSON.stringify(timestamp),
      jobId,
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
    return !!(await (<any>client).isMaxed(args));
  }

  async moveToDelayed(
    jobId: string,
    timestamp: number,
    delay: number,
    token = '0',
    opts: MoveToDelayedOpts = {},
  ): Promise<void> {
    const client = await this.queue.client;

    const args = this.moveToDelayedArgs(jobId, timestamp, token, delay, opts);
    const result = await (<any>client).moveToDelayed(args);
    if (result < 0) {
      throw this.finishedErrors({
        code: result,
        jobId,
        command: 'moveToDelayed',
        state: 'active',
      });
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
        throw this.finishedErrors({
          code: result,
          jobId,
          command: 'moveToWaitingChildren',
          state: 'active',
        });
    }
  }

  getRateLimitTtlArgs(maxJobs?: number): (string | number)[] {
    const keys: (string | number)[] = [this.queue.keys.limiter];

    return keys.concat([maxJobs ?? '0']);
  }

  async getRateLimitTtl(maxJobs?: number): Promise<number> {
    const client = await this.queue.client;

    const args = this.getRateLimitTtlArgs(maxJobs);
    return (<any>client).getRateLimitTtl(args);
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
      this.queue.toKey('repeat'),
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
    ]);
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

  async retryJobs(
    state: FinishedStatus = 'failed',
    count = 1000,
    timestamp = new Date().getTime(),
  ): Promise<number> {
    const client = await this.queue.client;

    const args = this.moveJobsToWaitArgs(state, count, timestamp);

    return (<any>client).moveJobsToWait(args);
  }

  async promoteJobs(count = 1000): Promise<number> {
    const client = await this.queue.client;

    const args = this.moveJobsToWaitArgs('delayed', count, Number.MAX_VALUE);

    return (<any>client).moveJobsToWait(args);
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
    job: MinimalJob<T, R, N>,
    state: 'failed' | 'completed',
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
    ];

    const result = await (<any>client).reprocessJob(keys.concat(args));

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

  async moveToActive(client: RedisClient, token: string, name?: string) {
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

    const result = await (<any>client).moveToActive(
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

    const code = await (<any>client).promote(keys.concat(args));
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
      this.queue.keys.failed,
      this.queue.keys['stalled-check'],
      this.queue.keys.meta,
      this.queue.keys.paused,
      this.queue.keys.marker,
      this.queue.keys.events,
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
  async moveStalledJobsToWait(): Promise<[string[], string[]]> {
    const client = await this.queue.client;

    const args = this.moveStalledJobsToWaitArgs();

    return (<any>client).moveStalledJobsToWait(args);
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
  async moveJobFromActiveToWait(jobId: string, token: string) {
    const client = await this.queue.client;
    const lockKey = `${this.queue.toKey(jobId)}:lock`;

    const keys: (string | number)[] = [
      this.queue.keys.active,
      this.queue.keys.wait,
      this.queue.keys.stalled,
      lockKey,
      this.queue.keys.paused,
      this.queue.keys.meta,
      this.queue.keys.limiter,
      this.queue.keys.prioritized,
      this.queue.keys.marker,
      this.queue.keys.events,
    ];

    const args = [jobId, token, this.queue.toKey(jobId)];

    const pttl = await (<any>client).moveJobFromActiveToWait(keys.concat(args));

    return pttl < 0 ? 0 : pttl;
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

  /**
   * Paginate a set or hash keys.
   * @param opts
   *
   */
  async paginate(
    key: string,
    opts: { start: number; end: number; fetchJobs?: boolean },
  ): Promise<{
    cursor: string;
    items: { id: string; v?: any; err?: string }[];
    total: number;
    jobs?: JobJsonRaw[];
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
      jobs: JobJsonRaw[] = [];
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

      [cursor, offset, items, total, rawJobs] = await (<any>client).paginate(
        keys.concat(args),
      );
      page = page.concat(items);

      if (rawJobs && rawJobs.length) {
        jobs = jobs.concat(rawJobs.map(array2obj));
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
