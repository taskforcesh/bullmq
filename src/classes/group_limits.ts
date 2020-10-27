import { RedisConnection } from './redis-connection';
import { GroupRates } from '../interfaces/rate-limiter-options';
import { ConnectionOptions } from '../interfaces';
import { Queue } from '../classes/queue';

/**
 * TODO: docs
 */
export class GroupLimits {
  protected connection: RedisConnection;

  constructor(
    public queue: Queue,
    public groupRates: GroupRates,
    redis_opts?: ConnectionOptions,
  ) {
    console.log('GroupLimits');
    this.connection = new RedisConnection(redis_opts);
  }

  async writeToRedis() {
    console.log('writeToRedis');
    const client = await this.connection.client;
    console.log('got client');
    for (const groupKey in this.groupRates) {
      console.log(`${groupKey}: ${JSON.stringify(this.groupRates[groupKey])}`);
      const max = this.groupRates[groupKey].max;
      const duration = this.groupRates[groupKey].duration;
      await client.hmset(
        `${this.queue.keyPrefix()}:group-limits`,
        `${groupKey}:max`,
        max,
        `${groupKey}:duration`,
        duration,
      );
    }
  }
}
