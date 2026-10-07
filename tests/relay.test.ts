import { afterAll, beforeAll } from 'vitest';
import { createRedisRelayBackend, IRedisClient, Relay } from '../src';
import { createTestConnection } from './utils/connection-factory';
import { describeRelay } from './utils/relay-suite';

const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

let connection: IRedisClient;

beforeAll(() => {
  connection = createTestConnection();
});

afterAll(async () => {
  await connection.quit();
});

async function scanKeys(match: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await connection.scan(cursor, {
      MATCH: match,
      COUNT: 1000,
    });
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

describeRelay('redis', {
  createBackend: namespace =>
    createRedisRelayBackend({ connection, namespace, prefix }),
  createRelay: opts => new Relay({ connection, prefix, ...opts }),
  countSubscriptions: async namespace => {
    let total = 0;
    for (const key of await scanKeys(`${prefix}:relay:${namespace}:sub:p:*`)) {
      total += (await connection.smembers(key)).length;
    }
    return total;
  },
  cleanup: async namespace => {
    const keys = await scanKeys(`${prefix}:relay:${namespace}:*`);
    if (keys.length > 0) {
      await connection.del(...keys);
    }
  },
});
