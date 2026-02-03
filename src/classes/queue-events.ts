import { Cluster } from 'ioredis';
import { JobProgress } from '../types';
import {
  IoredisListener,
  QueueEventsOptions,
  RedisClient,
  StreamReadRaw,
} from '../interfaces';
import {
  array2obj,
  clientCommandMessageReg,
  isRedisInstance,
  QUEUE_EVENT_SUFFIX,
} from '../utils';
import { QueueBase } from './queue-base';
import { RedisConnection } from './redis-connection';

export interface QueueEventsListener extends IoredisListener {
  /**
   * Listen to 'active' event.
   *
   * This event is triggered when a job enters the 'active' state, meaning it is being processed.
   *
   * @param args - An object containing details about the job that became active.
   *   - `jobId`: The unique identifier of the job that entered the active state.
   *   - `prev`: The previous state of the job before it became active (e.g., 'waiting'), if applicable.
   *
   * @param id - The identifier of the event.
   */

  active: (args: { jobId: string; prev?: string }, id: string) => void;

  /**
   * Listen to 'added' event.
   *
   * This event is triggered when a job is created and added to the queue.
   *
   * @param args - An object containing details about the newly added job.
   *   - `jobId` - The unique identifier of the job that was added.
   *   - `name` - The name of the job, typically indicating its type or purpose.
   * @param id - The identifier of the event.
   */
  added: (args: { jobId: string; name: string }, id: string) => void;

  /**
   * Listen to 'cleaned' event.
   *
   * This event is triggered when jobs are cleaned (e.g., removed) from the queue, typically via a cleanup method.
   *
   * @param args - An object containing the count of cleaned jobs.
   *   - `count` - The number of jobs that were cleaned, represented as a string due to Redis serialization.
   * @param id - The identifier of the event.
   */
  cleaned: (args: { count: string }, id: string) => void;

  /**
   * Listen to 'completed' event.
   *
   * This event is triggered when a job has successfully completed its execution.
   *
   * @param args - An object containing details about the completed job.
   *   - `jobId` - The unique identifier of the job that completed.
   *   - `returnvalue` - The return value of the job, serialized as a string.
   *   - `prev` - The previous state of the job before completion (e.g., 'active'), if applicable.
   * @param id - The identifier of the event.
   */
  completed: (
    args: { jobId: string; returnvalue: string; prev?: string },
    id: string,
  ) => void;

  /**
   * Listen to 'debounced' event.
   *
   * @deprecated Use the 'deduplicated' event instead.
   *
   * This event is triggered when a job is debounced because a job with the same debounceId still exists.
   *
   * @param args - An object containing details about the debounced job.
   *   - `jobId` - The unique identifier of the job that was debounced.
   *   - `debounceId` - The identifier used to debounce the job, preventing duplicate processing.
   * @param id - The identifier of the event.
   */
  debounced: (args: { jobId: string; debounceId: string }, id: string) => void;

  /**
   * Listen to 'deduplicated' event.
   *
   * This event is triggered when a job is not added to the queue because a job with the same deduplicationId
   * already exists.
   *
   * @param args - An object containing details about the deduplicated job.
   *  - `jobId` - The unique identifier of the job that was attempted to be added.
   *  - `deduplicationId` - The deduplication identifier that caused the job to be deduplicated.
   *  - `deduplicatedJobId` - The unique identifier of the existing job that caused the deduplication.
   * @param id - The identifier of the event.
   */
  deduplicated: (
    args: { jobId: string; deduplicationId: string; deduplicatedJobId: string },
    id: string,
  ) => void;

  /**
   * Listen to 'delayed' event.
   *
   * This event is triggered when a job is scheduled with a delay before it becomes active.
   *
   * @param args - An object containing details about the delayed job.
   *  - `jobId` - The unique identifier of the job that was delayed.
   *  - `delay` - The delay duration in milliseconds before the job becomes active.
   * @param id - The identifier of the event.
   */
  delayed: (args: { jobId: string; delay: number }, id: string) => void;

  /**
   * Listen to 'drained' event.
   *
   * This event is triggered when the queue has drained its waiting list, meaning there are no jobs
   * in the 'waiting' state.
   * Note that there could still be delayed jobs waiting their timers to expire
   * and this event will still be triggered as long as the waiting list has emptied.
   *
   * @param id - The identifier of the event.
   */
  drained: (id: string) => void;

  /**
   * Listen to 'duplicated' event.
   *
   * This event is triggered when a job is not created because a job with the same identifier already exists.
   *
   * @param args - An object containing the job identifier.
   *  - `jobId` - The unique identifier of the job that was attempted to be added.
   * @param id - The identifier of the event.
   */
  duplicated: (args: { jobId: string }, id: string) => void;

  /**
   * Listen to 'error' event.
   *
   * This event is triggered when an error in the Redis backend is thrown.
   */
  error: (args: Error) => void;

  /**
   * Listen to 'failed' event.
   *
   * This event is triggered when a job fails by throwing an exception during execution.
   *
   * @param args - An object containing details about the failed job.
   *  - `jobId` - The unique identifier of the job that failed.
   *  - `failedReason` - The reason or message describing why the job failed.
   *  - `prev` - The previous state of the job before failure (e.g., 'active'), if applicable.
   * @param id - The identifier of the event.
   */
  failed: (
    args: { jobId: string; failedReason: string; prev?: string },
    id: string,
  ) => void;

  /**
   * Listen to 'paused' event.
   *
   * This event is triggered when the queue is paused, halting the processing of new jobs.
   *
   * @param args - An empty object (no additional data provided).
   * @param id - The identifier of the event.
   */
  paused: (args: object, id: string) => void;

  /**
   * Listen to 'progress' event.
   *
   * This event is triggered when a job updates its progress via the `Job#updateProgress()` method, allowing
   * progress or custom data to be communicated externally.
   *
   * @param args - An object containing the job identifier and progress data.
   *  - `jobId` - The unique identifier of the job reporting progress.
   *  - `data` - The progress data, which can be a number (e.g., percentage) or an object with custom data.
   * @param id - The identifier of the event.
   */
  progress: (args: { jobId: string; data: JobProgress }, id: string) => void;

  /**
   * Listen to 'removed' event.
   *
   * This event is triggered when a job is manually removed from the queue.
   *
   * @param args - An object containing details about the removed job.
   *  - `jobId` - The unique identifier of the job that was removed.
   *  - `prev` - The previous state of the job before removal (e.g., 'active' or 'waiting').
   * @param id - The identifier of the event.
   */
  removed: (args: { jobId: string; prev: string }, id: string) => void;

  /**
   * Listen to 'resumed' event.
   *
   * This event is triggered when the queue is resumed, allowing job processing to continue.
   *
   * @param args - An empty object (no additional data provided).
   * @param id - The identifier of the event.
   */
  resumed: (args: object, id: string) => void;

  /**
   * Listen to 'retries-exhausted' event.
   *
   * This event is triggered when a job has exhausted its maximum retry attempts after repeated failures.
   *
   * @param args - An object containing details about the job that exhausted retries.
   *  - `jobId` - The unique identifier of the job that exhausted its retries.
   *  - `attemptsMade` - The number of retry attempts made, represented as a string
   * (due to Redis serialization).
   * @param id - The identifier of the event.
   */
  'retries-exhausted': (
    args: { jobId: string; attemptsMade: string },
    id: string,
  ) => void;

  /**
   * Listen to 'stalled' event.
   *
   * This event is triggered when a job moves from 'active' back to 'waiting' or
   * 'failed' because the processor could not renew its lock, indicating a
   * potential processing issue.
   *
   * @param args - An object containing the job identifier.
   *  - `jobId` - The unique identifier of the job that stalled.
   * @param id - The identifier of the event.
   */
  stalled: (args: { jobId: string }, id: string) => void;

  /**
   * Listen to 'waiting' event.
   *
   * This event is triggered when a job enters the 'waiting' state, indicating it is queued and
   * awaiting processing.
   *
   * @param args - An object containing details about the job in the waiting state.
   *  - `jobId` - The unique identifier of the job that is waiting.
   *  - `prev` - The previous state of the job before entering 'waiting' (e.g., 'stalled'),
   * if applicable.
   * @param id - The identifier of the event.
   */

  waiting: (args: { jobId: string; prev?: string }, id: string) => void;

  /**
   * Listen to 'waiting-children' event.
   *
   * This event is triggered when a job enters the 'waiting-children' state, indicating it is
   * waiting for its child jobs to complete.
   *
   * @param args - An object containing the job identifier.
   *  - `jobId` - The unique identifier of the job waiting for its children.
   * @param id - The identifier of the event.
   */
  'waiting-children': (args: { jobId: string }, id: string) => void;
}

type CustomParameters<T> = T extends (...args: infer Args) => void
  ? Args
  : never;

type KeyOf<T extends object> = Extract<keyof T, string>;

/**
 * The QueueEvents class is used for listening to the global events
 * emitted by a given queue.
 *
 * This class requires a dedicated redis connection.
 *
 */
export class QueueEvents extends QueueBase {
  private running = false;
  private blocking = false;

  constructor(
    name: string,
    { connection, autorun = true, ...opts }: QueueEventsOptions = {
      connection: {},
    },
    Connection?: typeof RedisConnection,
  ) {
    super(
      name,
      {
        ...opts,
        connection: isRedisInstance(connection)
          ? (<RedisClient>connection).isCluster
            ? (<Cluster>connection).duplicate(undefined, {
                redisOptions: (<Cluster>connection).options?.redisOptions,
              })
            : (<RedisClient>connection).duplicate()
          : connection,
      },
      Connection,
      true,
    );

    this.opts = Object.assign(
      {
        blockingTimeout: 10000,
      },
      this.opts,
    );

    if (autorun) {
      this.run().catch(error => this.emit('error', error));
    }
  }

  emit<
    QEL extends QueueEventsListener = QueueEventsListener,
    U extends KeyOf<QEL> = KeyOf<QEL>,
  >(event: U, ...args: CustomParameters<QEL[U]>): boolean {
    return super.emit(event, ...args);
  }

  off<
    QEL extends QueueEventsListener = QueueEventsListener,
    U extends KeyOf<QEL> = KeyOf<QEL>,
  >(eventName: U, listener: QEL[U]): this {
    super.off(eventName, listener as (...args: any[]) => void);
    return this;
  }

  on<
    QEL extends QueueEventsListener = QueueEventsListener,
    U extends KeyOf<QEL> = KeyOf<QEL>,
  >(event: U, listener: QEL[U]): this {
    super.on(event, listener as (...args: any[]) => void);
    return this;
  }

  once<
    QEL extends QueueEventsListener = QueueEventsListener,
    U extends KeyOf<QEL> = KeyOf<QEL>,
  >(event: U, listener: QEL[U]): this {
    super.once(event, listener as (...args: any[]) => void);
    return this;
  }

  /**
   * Manually starts running the event consumming loop. This shall be used if you do not
   * use the default "autorun" option on the constructor.
   */
  async run(): Promise<void> {
    if (!this.running) {
      try {
        this.running = true;
        const client = await this.client;

        // TODO: Planed for deprecation as it has no really a use case
        try {
          await client.client('SETNAME', this.clientName(QUEUE_EVENT_SUFFIX));
        } catch (err) {
          if (!clientCommandMessageReg.test((<Error>err).message)) {
            throw err;
          }
        }

        await this.consumeEvents(client);
      } catch (error) {
        this.running = false;
        throw error;
      }
    } else {
      throw new Error('Queue Events is already running.');
    }
  }

  private async consumeEvents(client: RedisClient): Promise<void> {
    const opts: QueueEventsOptions = this.opts;

    const key = this.keys.events;
    let id = opts.lastEventId || '$';

    while (!this.closing) {
      this.blocking = true;
      // Cast to actual return type, see: https://github.com/DefinitelyTyped/DefinitelyTyped/issues/44301
      const data: StreamReadRaw = await this.checkConnectionError(() =>
        client.xread('BLOCK', opts.blockingTimeout!, 'STREAMS', key, id),
      );
      this.blocking = false;
      if (data) {
        const stream = data[0];
        const events = stream[1];

        for (let i = 0; i < events.length; i++) {
          id = events[i][0];
          const args = array2obj(events[i][1]);

          //
          // TODO: we may need to have a separate xtream for progress data
          // to avoid this hack.
          switch (args.event) {
            case 'progress':
              args.data = JSON.parse(args.data);
              break;
            case 'completed':
              args.returnvalue = JSON.parse(args.returnvalue);
              break;
          }

          const { event, ...restArgs } = args;

          if (event === 'drained') {
            this.emit(event, id);
          } else {
            this.emit(event as any, restArgs, id);
            if (restArgs.jobId) {
              this.emit(`${event}:${restArgs.jobId}` as any, restArgs, id);
            }
          }
        }
      }
    }
  }

  /**
   * Stops consuming events and close the underlying Redis connection if necessary.
   *
   * @returns
   */
  async close(): Promise<void> {
    if (!this.closing) {
      this.closing = (async () => {
        try {
          // As the connection has been wrongly markes as "shared" by QueueBase,
          // we need to forcibly close it here. We should fix QueueBase to avoid this in the future.
          const client = await this.client;
          client.disconnect();
          await this.connection.close(this.blocking);
        } finally {
          this.closed = true;
        }
      })();
    }
    return this.closing;
  }
}
