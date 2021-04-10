import { RedisConnection } from './redis-connection';
import { GroupRates } from '../interfaces/rate-limiter-options';
import { ConnectionOptions } from '../interfaces';
import { Queue } from '../classes/queue';

/**
 * Facilitates adding queue group-specific rate limits.
 */
export class GroupLimits {
  protected connection: RedisConnection;

  constructor(redis_opts?: ConnectionOptions) {
    this.connection = new RedisConnection(redis_opts);
  }

  /**
   * Add the groupRates specificed for a specific queue to Redis
   * @param queue the queue to add groupRates for
   * @param groupRates the defined group rate limits
   * @param redis_opts optional redis connection info
   */
  async addQueueLimits(queue: Queue, groupRates: GroupRates) {
    const client = await this.connection.client;
    for (const groupKey in groupRates) {
      const bruh = await client.hmset(
        `${queue.keyPrefix()}:group-limits`,
        `${groupKey}:max`,
        groupRates[groupKey].max,
        `${groupKey}:duration`,
        groupRates[groupKey].duration,
      );
    }
  }
}
