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
   * This event is triggered when a job enters the 'active' state.
   */
  active: (args: { jobId: string; prev?: string }, id: string) => void;

  /**
   * Listen to 'added' event.
   *
   * This event is triggered when a job is created.
   */
  added: (
    args: { jobId: string; name: string; data: string; opts: string },
    id: string,
  ) => void;

  /**
   * Listen to 'cleaned' event.
   *
   * This event is triggered when a cleaned method is triggered.
   */
  cleaned: (args: { count: string }, id: string) => void;

  /**
   * Listen to 'completed' event.
   *
   * This event is triggered when a job has successfully completed.
   */
  completed: (
    args: { jobId: string; returnvalue: string; prev?: string },
    id: string,
  ) => void;

  /**
   * Listen to 'delayed' event.
   *
   * This event is triggered when a job is delayed.
   */
  delayed: (args: { jobId: string; delay: number }, id: string) => void;

  /**
   * Listen to 'drained' event.
   *
   * This event is triggered when the queue has drained the waiting list.
   * Note that there could still be delayed jobs waiting their timers to expire
   * and this event will still be triggered as long as the waiting list has emptied.
   */
  drained: (id: string) => void;

  /**
   * Listen to 'error' event.
   *
   * This event is triggered when an exception is thrown.
   */
  error: (args: Error) => void;

  /**
   * Listen to 'failed' event.
   *
   * This event is triggered when a job has thrown an exception.
   */
  failed: (
    args: { jobId: string; failedReason: string; prev?: string },
    id: string,
  ) => void;

  /**
   * Listen to 'paused' event.
   *
   * This event is triggered when a queue is paused.
   */
  paused: (args: {}, id: string) => void;

  /**
   * Listen to 'progress' event.
   *
   * This event is triggered when a job updates it progress, i.e. the
   * Job##updateProgress() method is called. This is useful to notify
   * progress or any other data from within a processor to the rest of the
   * world.
   */
  progress: (
    args: { jobId: string; data: number | object },
    id: string,
  ) => void;

  /**
   * Listen to 'removed' event.
   *
   * This event is triggered when a job has been manually
   * removed from the queue.
   */
  removed: (args: { jobId: string; prev: string }, id: string) => void;

  /**
   * Listen to 'resumed' event.
   *
   * This event is triggered when a queue is resumed.
   */
  resumed: (args: {}, id: string) => void;

  /**
   * Listen to 'retries-exhausted' event.
   *
   * This event is triggered when a job has retried the maximum attempts.
   */
  'retries-exhausted': (
    args: { jobId: string; attemptsMade: string },
    id: string,
  ) => void;

  /**
   * Listen to 'stalled' event.
   *
   * This event is triggered when a job has been moved from 'active' back
   * to 'waiting'/'failed' due to the processor not being able to renew
   * the lock on the said job.
   */
  stalled: (args: { jobId: string }, id: string) => void;

  /**
   * Listen to 'waiting' event.
   *
   * This event is triggered when a job enters the 'waiting' state.
   */
  waiting: (args: { jobId: string }, id: string) => void;

  /**
   * Listen to 'waiting-children' event.
   *
   * This event is triggered when a job enters the 'waiting-children' state.
   */
  'waiting-children': (args: { jobId: string }, id: string) => void;
}

/**
 * The QueueEvents class is used for listening to the global events
 * emitted by a given queue.
 *
 * This class requires a dedicated redis connection.
 *
 */
export class QueueEvents extends QueueBase {
  private running = false;

  constructor(
    name: string,
    { connection, autorun = true, ...opts }: QueueEventsOptions = {},
    Connection?: typeof RedisConnection,
  ) {
    super(
      name,
      {
        ...opts,
        connection: isRedisInstance(connection)
          ? (<RedisClient>connection).duplicate()
          : connection,
        blockingConnection: true,
      },
      Connection,
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

  emit<U extends keyof QueueEventsListener>(
    event: U,
    ...args: Parameters<QueueEventsListener[U]>
  ): boolean {
    return super.emit(event, ...args);
  }

  off<U extends keyof QueueEventsListener>(
    eventName: U,
    listener: QueueEventsListener[U],
  ): this {
    super.off(eventName, listener);
    return this;
  }

  on<U extends keyof QueueEventsListener>(
    event: U,
    listener: QueueEventsListener[U],
  ): this {
    super.on(event, listener);
    return this;
  }

  once<U extends keyof QueueEventsListener>(
    event: U,
    listener: QueueEventsListener[U],
  ): this {
    super.once(event, listener);
    return this;
  }

  async run(): Promise<void> {
    if (!this.running) {
      try {
        this.running = true;
        const client = await this.client;

        try {
          await client.client('setname', this.clientName(QUEUE_EVENT_SUFFIX));
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
      // Cast to actual return type, see: https://github.com/DefinitelyTyped/DefinitelyTyped/issues/44301
      const data: StreamReadRaw = await this.checkConnectionError(() =>
        client.xread('BLOCK', opts.blockingTimeout, 'STREAMS', key, id),
      );
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
            this.emit(`${event}:${restArgs.jobId}` as any, restArgs, id);
          }
        }
      }
    }
  }

  close(): Promise<void> {
    if (!this.closing) {
      this.closing = this.disconnect();
    }
    return this.closing;
  }
}
