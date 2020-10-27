import { RedisConnection } from './redis-connection';
import { GroupRates } from '../interfaces/rate-limiter-options';
import { ConnectionOptions } from '../interfaces';
import { Queue } from '../classes/queue';

/**
 * TODO: just put this all in an sync method instead of a class?
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
    console.log(`got client: ${client}`);
    for (const groupKey in this.groupRates) {
      console.log(`${groupKey}: ${JSON.stringify(this.groupRates[groupKey])}`);
      const max = this.groupRates[groupKey].max;
      const duration = this.groupRates[groupKey].duration;
      const groupLimitsKey = `${this.queue.keyPrefix()}:group-limits`;
      console.log(`generated groupLimitsKey: ${groupLimitsKey}`);
      const bruh = await client.hmset(
        groupLimitsKey,
        `${groupKey}:max`,
        max,
        `${groupKey}:duration`,
        duration,
      );
      console.log(`bruh: ${JSON.stringify(bruh)}`);
    }
  }
}
