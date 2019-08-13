/**
 * Includes all the scripts needed by the queue and jobs.
 */

/*eslint-env node */
'use strict';

import { QueueKeeperOptions } from '@src/interfaces';
import { WorkerOptions } from '@src/interfaces/worker-opts';
import IORedis from 'ioredis';
import { JobsOpts } from '../interfaces';
import { array2obj } from '../utils';
import { Job, JobJson } from './job';
import { Queue } from './queue';
import { QueueBase } from './queue-base';
import { QueueScheduler } from './queue-scheduler';
import { Worker } from './worker';

export class Scripts {
  static async isJobInList(
    client: IORedis.Redis,
    listKey: string,
    jobId: string,
  ) {
    const result = await (<any>client).isJobInList([listKey, jobId]);
    return result === 1;
  }

  static addJob(
    client: IORedis.Redis,
    queue: QueueBase,
    job: JobJson,
    opts: JobsOpts,
    jobId: string,
  ) {
    const queueKeys = queue.keys;
    let keys = [
      queueKeys.wait,
      queueKeys.paused,
      queueKeys['meta-paused'],
      queueKeys.id,
      queueKeys.delayed,
      queueKeys.priority,
      queue.eventStreamKey(),
      queue.delayStreamKey(),
    ];

    const args = [
      queueKeys[''],
      typeof jobId !== 'undefined' ? jobId : '',
      job.name,
      job.data,
      job.opts,
      job.timestamp,
      opts.delay,
      opts.delay ? job.timestamp + opts.delay : 0,
      opts.priority || 0,
      opts.lifo ? 'RPUSH' : 'LPUSH',
    ];

    keys = keys.concat(<string[]>args);
    return (<any>client).addJob(keys);
  }

  static pause(queue: Queue, pause: boolean) {
    var src = 'wait',
      dst = 'paused';
    if (!pause) {
      src = 'paused';
      dst = 'wait';
    }

    const keys = [src, dst, 'meta-paused'].map((name: string) =>
      queue.toKey(name),
    );

    keys.push(queue.eventStreamKey());

    return (<any>queue.client).pause(
      keys.concat([pause ? 'paused' : 'resumed']),
    );
  }

  static remove(queue: QueueBase, jobId: string) {
    const keys = [
      'active',
      'wait',
      'delayed',
      'paused',
      'completed',
      'failed',
      'priority',
      jobId,
      `${jobId}:logs`,
    ].map(name => queue.toKey(name));
    return (<any>queue.client).removeJob(
      keys.concat([queue.eventStreamKey(), jobId]),
    );
  }

  static async updateProgress(
    queue: QueueBase,
    job: Job,
    progress: number | object,
  ) {
    const keys = [job.id, 'progress'].map(function(name) {
      return queue.toKey(name);
    });

    const progressJson = JSON.stringify(progress);

    await (<any>queue.client).updateProgress(keys, [
      progressJson,
      job.id + ',' + progressJson,
    ]);
    queue.emit('progress', job, progress);
  }

  static moveToFinishedArgs(
    queue: QueueBase,
    job: Job,
    val: any,
    propVal: string,
    shouldRemove: boolean | number,
    target: string,
    fetchNext = true,
  ) {
    const queueKeys = queue.keys;

    const keys = [
      queueKeys.active,
      queueKeys[target],
      queue.toKey(job.id),
      queueKeys.wait,
      queueKeys.priority,
      queue.eventStreamKey(),
    ];

    let remove;
    if (typeof shouldRemove === 'boolean') {
      remove = shouldRemove ? '1' : '0';
    } else if (typeof shouldRemove === 'number') {
      remove = `${shouldRemove + 1}`;
    }

    const args = [
      job.id,
      Date.now(),
      propVal,
      typeof val === 'undefined' ? 'null' : val,
      target,
      remove,
      JSON.stringify({ jobId: job.id, val: val }),
      !fetchNext || queue.closing || (<WorkerOptions>queue.opts).limiter
        ? 0
        : 1,
      queueKeys[''],
    ];

    return keys.concat(args);
  }

  static async moveToFinished(
    queue: QueueBase,
    job: Job,
    val: any,
    propVal: string,
    shouldRemove: boolean | number,
    target: string,
    fetchNext: boolean,
  ) {
    const args = this.moveToFinishedArgs(
      queue,
      job,
      val,
      propVal,
      shouldRemove,
      target,
      fetchNext,
    );

    const result = await (<any>queue.client).moveToFinished(args);
    if (result < 0) {
      throw this.finishedErrors(result, job.id, 'finished');
    } else if (result) {
      return <[JobJson, string]>raw2jobData(result);
    }
  }

  static finishedErrors(code: number, jobId: string, command: string) {
    switch (code) {
      case -1:
        return new Error('Missing key for job ' + jobId + ' ' + command);
      case -2:
        return new Error('Missing lock for job ' + jobId + ' ' + command);
    }
  }

  // TODO: add a retention argument for completed and finished jobs (in time).
  static moveToCompleted(
    queue: QueueBase,
    job: Job,
    returnvalue: any,
    removeOnComplete: boolean | number,
    fetchNext: boolean,
  ): Promise<[JobJson, string]> {
    return this.moveToFinished(
      queue,
      job,
      returnvalue,
      'returnvalue',
      removeOnComplete,
      'completed',
      fetchNext,
    );
  }

  static moveToFailedArgs(
    queue: QueueBase,
    job: Job,
    failedReason: string,
    removeOnFailed: boolean | number,
    fetchNext = false,
  ) {
    return this.moveToFinishedArgs(
      queue,
      job,
      failedReason,
      'failedReason',
      removeOnFailed,
      'failed',
      fetchNext,
    );
  }

  static isFinished(queue: QueueBase, jobId: string) {
    const keys = ['completed', 'failed'].map(function(key: string) {
      return queue.toKey(key);
    });

    return (<any>queue.client).isFinished(keys.concat([jobId]));
  }

  // Note: We have an issue here with jobs using custom job ids
  static moveToDelayedArgs(queue: QueueBase, jobId: string, timestamp: number) {
    //
    // Bake in the job id first 12 bits into the timestamp
    // to guarantee correct execution order of delayed jobs
    // (up to 4096 jobs per given timestamp or 4096 jobs apart per timestamp)
    //
    // WARNING: Jobs that are so far apart that they wrap around will cause FIFO to fail
    //
    timestamp = typeof timestamp === 'undefined' ? 0 : timestamp;

    timestamp = +timestamp || 0;
    timestamp = timestamp < 0 ? 0 : timestamp;
    if (timestamp > 0) {
      timestamp = timestamp * 0x1000 + (+jobId & 0xfff);
    }

    const keys = ['active', 'delayed', jobId].map(function(name) {
      return queue.toKey(name);
    });
    keys.push.apply(keys, [queue.eventStreamKey(), queue.delayStreamKey()]);

    return keys.concat([JSON.stringify(timestamp), jobId]);
  }

  static async moveToDelayed(
    queue: QueueBase,
    jobId: string,
    timestamp: number,
  ) {
    const args = this.moveToDelayedArgs(queue, jobId, timestamp);
    const result = await (<any>queue.client).moveToDelayed(args);
    switch (result) {
      case -1:
        throw new Error(
          'Missing Job ' +
            jobId +
            ' when trying to move from active to delayed',
        );
    }
  }

  static cleanJobsInSet(
    queue: QueueBase,
    set: string,
    timestamp: number,
    limit = 0,
  ) {
    return (<any>queue.client).cleanJobsInSet([
      queue.toKey(set),
      queue.toKey(''),
      timestamp,
      limit,
      set,
    ]);
  }

  static retryJobArgs(queue: QueueBase, job: Job) {
    const jobId = job.id;

    const keys = ['active', 'wait', jobId].map(function(name) {
      return queue.toKey(name);
    });

    keys.push(queue.eventStreamKey());

    const pushCmd = (job.opts.lifo ? 'R' : 'L') + 'PUSH';

    return keys.concat([pushCmd, jobId]);
  }

  /**
   * Attempts to reprocess a job
   *
   * @param {Job} job
   * @param {Object} options
   * @param {String} options.state The expected job state. If the job is not found
   * on the provided state, then it's not reprocessed. Supported states: 'failed', 'completed'
   *
   * @return {Promise<Number>} Returns a promise that evaluates to a return code:
   * 1 means the operation was a success
   * 0 means the job does not exist
   * -1 means the job is currently locked and can't be retried.
   * -2 means the job was not found in the expected set
   */
  static reprocessJob(
    queue: QueueBase,
    job: Job,
    state: 'failed' | 'completed',
  ) {
    const keys = [
      queue.toKey(job.id),
      queue.eventStreamKey(),
      queue.toKey(state),
      queue.toKey('wait'),
    ];

    const args = [job.id, (job.opts.lifo ? 'R' : 'L') + 'PUSH'];

    return (<any>queue.client).reprocessJob(keys.concat(args));
  }

  static moveToActive(queue: Worker, jobId: string) {
    const queueKeys = queue.keys;
    const keys = [queueKeys.wait, queueKeys.active, queueKeys.priority];

    keys[3] = queue.eventStreamKey();
    keys[4] = queueKeys.stalled;
    keys[5] = queueKeys.limiter;
    keys[6] = queueKeys.delayed;
    keys[7] = queue.eventStreamKey();
    keys[8] = queue.delayStreamKey();

    const args: (string | number | boolean)[] = [
      queueKeys[''],
      Date.now(),
      jobId,
    ];

    const opts: WorkerOptions = <WorkerOptions>queue.opts;

    if (opts.limiter) {
      args.push(opts.limiter.max, opts.limiter.duration);
    }
    return (<any>queue.client)
      .moveToActive((<(string | number | boolean)[]>keys).concat(args))
      .then(raw2jobData);
  }

  //
  //  It checks if the job in the top of the delay set should be moved back to the
  //  top of the  wait queue (so that it will be processed as soon as possible)
  //
  static updateDelaySet(queue: QueueBase, delayedTimestamp: number) {
    const keys: (string | number)[] = [
      queue.keys.delayed,
      queue.keys.wait,
      queue.keys.priority,
      queue.keys.paused,
      queue.keys['meta-paused'],
      queue.eventStreamKey(),
      queue.delayStreamKey(),
    ];

    const args = [queue.toKey(''), delayedTimestamp];

    return (<any>queue.client).updateDelaySet(keys.concat(args));
  }

  static promote(queue: QueueBase, jobId: string) {
    const keys = [
      queue.keys.delayed,
      queue.keys.wait,
      queue.keys.priority,
      queue.eventStreamKey(),
    ];

    const args = [queue.toKey(''), jobId];

    return (<any>queue.client).promote(keys.concat(args));
  }

  //
  // Looks for unlocked jobs in the active queue.
  //
  //    The job was being worked on, but the worker process died and it failed to renew the lock.
  //    We call these jobs 'stalled'. This is the most common case. We resolve these by moving them
  //    back to wait to be re-processed. To prevent jobs from cycling endlessly between active and wait,
  //    (e.g. if the job handler keeps crashing),
  //    we limit the number stalled job recoveries to settings.maxStalledCount.
  //
  static moveStalledJobsToWait(queue: QueueScheduler) {
    const keys: (string | number)[] = [
      queue.keys.stalled,
      queue.keys.wait,
      queue.keys.active,
      queue.keys.failed,
      queue.keys['stalled-check'],
      queue.keys['meta-paused'],
      queue.keys.paused,
      queue.eventStreamKey(),
    ];
    const args = [
      (<QueueKeeperOptions>queue.opts).maxStalledCount,
      queue.toKey(''),
      Date.now(),
      (<QueueKeeperOptions>queue.opts).stalledInterval,
    ];
    return (<any>queue.client).moveStalledJobsToWait(keys.concat(args));
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

function raw2jobData(raw: any[]) {
  if (raw) {
    const jobData = raw[0];
    if (jobData.length) {
      const job = array2obj(jobData);
      return [job, raw[1]];
    }
  }
  return [];
}
