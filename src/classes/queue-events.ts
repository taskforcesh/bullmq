import { QueueEventsOptions } from '../interfaces';
import {
  array2obj,
  delay,
  isNotConnectionError,
  isRedisInstance,
} from '../utils';
import { StreamReadRaw } from '../interfaces/redis-streams';
import { DELAY_TIME_5 } from '../utils';
import { QueueBase } from './queue-base';
import { RedisClient, RedisConnection } from './redis-connection';

export declare interface QueueEventsDeclaration {
  /**
   * Listen to 'active' event.
   *
   * This event is triggered when a job enters the 'active' state.
   *
   * @param {'active'} event
   * @callback listener
   */
  on(
    event: 'active',
    listener: (args: { jobId: string; prev?: string }, id: string) => void,
  ): this;

  /**
   * Listen to 'added' event.
   *
   * This event is triggered when a job is created.
   *
   * @param {'added'} event
   * @callback listener
   */
  on(
    event: 'added',
    listener: (
      args: { jobId: string; name: string; data: string; opts: string },
      id: string,
    ) => void,
  ): this;

  /**
   * Listen to 'completed' event.
   *
   * This event is triggered when a job has successfully completed.
   *
   * @param {'completed'} event
   * @callback listener
   */
  on(
    event: 'completed',
    listener: (
      args: { jobId: string; returnvalue: string; prev?: string },
      id: string,
    ) => void,
  ): this;

  /**
   * Listen to 'delayed' event.
   *
   * This event is triggered when a job is delayed.
   *
   * @param {'delayed'} event
   * @callback listener
   */
  on(
    event: 'delayed',
    listener: (args: { jobId: string; delay: number }, id: string) => void,
  ): this;

  /**
   * Listen to 'drained' event.
   *
   * This event is triggered when the queue has drained the waiting list.
   * Note that there could still be delayed jobs waiting their timers to expire
   * and this event will still be triggered as long as the waiting list has emptied.
   *
   * @param {'drained'} event
   * @callback listener
   */
  on(event: 'drained', listener: (id: string) => void): this;

  /**
   * Listen to 'progress' event.
   *
   * This event is triggered when a job updates it progress, i.e. the
   * Job##updateProgress() method is called. This is useful to notify
   * progress or any other data from within a processor to the rest of the
   * world.
   *
   * @param {'progress'} event
   * @callback listener
   */
  on(
    event: 'progress',
    listener: (
      args: { jobId: string; data: number | object },
      id: string,
    ) => void,
  ): this;

  /**
   * Listen to 'waiting' event.
   *
   * This event is triggered when a job enters the 'waiting' state.
   *
   * @param {'waiting'} event
   * @callback listener
   */
  on(
    event: 'waiting',
    listener: (args: { jobId: string }, id: string) => void,
  ): this;

  /**
   * Listen to 'stalled' event.
   *
   * This event is triggered when a job has been moved from 'active' back
   * to 'waiting'/'failed' due to the processor not being able to renew
   * the lock on the said job.
   *
   * @param {'stalled'} event
   * @callback listener
   */
  on(
    event: 'stalled',
    listener: (args: { jobId: string }, id: string) => void,
  ): this;

  /**
   * Listen to 'failed' event.
   *
   * This event is triggered when a job has thrown an exception.
   *
   * @param {'failed'} event
   * @callback listener
   */
  on(
    event: 'failed',
    listener: (
      args: { jobId: string; failedReason: string; prev?: string },
      id: string,
    ) => void,
  ): this;

  /**
   * Listen to 'removed' event.
   *
   * This event is triggered when a job has been manually
   * removed from the queue.
   *
   * @param {'removed'} event
   * @callback listener
   */
  on(
    event: 'removed',
    listener: (args: { jobId: string }, id: string) => void,
  ): this;

  /**
   * Listen to 'waiting-children' event.
   *
   * This event is triggered when a job enters the 'waiting-children' state.
   *
   * @param {'waiting-children'} event
   * @callback listener
   */
  on(
    event: 'waiting-children',
    listener: (args: { jobId: string }, id: string) => void,
  ): this;

  on(event: string, listener: Function): this;
}

/**
 * The QueueEvents class is used for listening to the global events
 * emitted by a given queue.
 *
 * This class requires a dedicated redis connection.
 *
 */
export class QueueEvents extends QueueBase implements QueueEventsDeclaration {
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

  async run(): Promise<void> {
    if (!this.running) {
      try {
        this.running = true;
        const client = await this.client;

        await this.consumeEvents(client);
      } catch (error) {
        this.running = false;
        throw error;
      }
    } else {
      throw new Error('Queue Events is already running.');
    }
  }

  private async consumeEvents(client: RedisClient) {
    const opts: QueueEventsOptions = this.opts;

    const key = this.keys.events;
    let id = opts.lastEventId || '$';

    while (!this.closing) {
      try {
        // Cast to actual return type, see: https://github.com/DefinitelyTyped/DefinitelyTyped/issues/44301
        const data: StreamReadRaw = (await client.xread(
          'BLOCK',
          opts.blockingTimeout,
          'STREAMS',
          key,
          id,
        )) as any;

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
              this.emit(event, restArgs, id);
              this.emit(`${event}:${restArgs.jobId}`, restArgs, id);
            }
          }
        }
      } catch (err) {
        if (isNotConnectionError(err as Error)) {
          throw err;
        }

        await delay(DELAY_TIME_5);
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
