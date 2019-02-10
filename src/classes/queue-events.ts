import { QueueEventsOptions } from '@src/interfaces';
import { QueueBase } from './queue-base';
import { array2obj } from '../utils';

export class QueueEvents extends QueueBase {
  constructor(name: string, opts?: QueueEventsOptions) {
    super(name, opts);

    this.opts = Object.assign(
      {
        blockingTimeout: 10000,
      },
      this.opts,
    );
  }

  async init() {
    this.client = await this.connection.init();
    this.consumeEvents();
  }

  private async consumeEvents() {
    const opts: QueueEventsOptions = this.opts;

    const key = this.eventStreamKey();
    let id = opts.lastEventId || '0-0';

    while (!this.closing) {
      const data = await this.client.xread(
        'BLOCK',
        opts.blockingTimeout,
        'STREAMS',
        key,
        id,
      );

      if (data) {
        const stream = data[0];
        const events = stream[1];

        for (let i = 0; i < events.length; i++) {
          id = events[i][0];
          const args = array2obj(events[i][1]);
          this.emit(args.event, args, id);
          this.emit(`${args.event}:${args.jobId}`, args, id);
        }
      }
    }
  }
}
