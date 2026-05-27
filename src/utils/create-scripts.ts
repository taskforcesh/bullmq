import { MinimalQueue } from '../interfaces';
import { Scripts } from '../classes/scripts';

/*
 * Factory method to create a Scripts object.
 */
export const createScripts = (queue: MinimalQueue) => {
  return new Scripts({
    keys: queue.keys,
    client: queue.client,
    get redisVersion() {
      return queue.redisVersion;
    },
    toKey: queue.toKey,
    opts: queue.opts,
    closing: queue.closing,
    databaseType: queue.databaseType,
  });
};
