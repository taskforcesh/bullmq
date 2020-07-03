import { QueueEventsOptions } from '../interfaces';
import { array2obj, delay } from '../utils';
import { QueueBase } from './queue-base';
import { StreamReadRaw } from '../interfaces/redis-streams';

export declare interface QueueEvents {
  on(
    event: 'waiting',
    listener: (args: { jobId: string }, id: string) => void,
  ): this;
  on(
    event: 'delayed',
    listener: (args: { jobId: string; delay: number }, id: string) => void,
  ): this;
  on(
    event: 'progress',
    listener: (args: { jobId: string; data: string }, id: string) => void,
  ): this;
  on(
    event: 'stalled',
    listener: (args: { jobId: string }, id: string) => void,
  ): this;
  on(
    event: 'completed',
    listener: (
      args: { jobId: string; returnvalue: string; prev?: string },
      id: string,
    ) => void,
  ): this;
  on(
    event: 'failed',
    listener: (
      args: { jobId: string; failedReason: string; prev?: string },
      id: string,
    ) => void,
  ): this;
  on(
    event: 'removed',
    listener: (args: { jobId: string }, id: string) => void,
  ): this;
  on(event: 'drained', listener: (id: string) => void): this;
  on(event: string, listener: Function): this;
}

export class QueueEvents extends QueueBase {
  constructor(name: string, opts?: QueueEventsOptions) {
    super(name, opts);

    this.opts = Object.assign(
      {
        blockingTimeout: 10000,
      },
      this.opts,
    );

    this.consumeEvents().catch(err => this.emit('error', err));
  }

  private async consumeEvents() {
    const client = await this.client;

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

            this.emit(args.event, args, id);
            this.emit(`${args.event}:${args.jobId}`, args, id);
          }
        }
      } catch (err) {
        if (err.message !== 'Connection is closed.') {
          throw err;
        }
        await delay(5000);
      }
    }
  }

  async close() {
    if (!this.closing) {
      this.closing = this.disconnect();
    }
    return this.closing;
  }
}
