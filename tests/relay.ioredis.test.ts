import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { default as IORedis } from 'ioredis';
import { randomUUID } from 'crypto';
import { Relay } from '../src';
import { waitFor } from './utils/relay-suite';

const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';
const redisHost = process.env.REDIS_HOST || 'localhost';

describe('Relay on ioredis', () => {
  let admin: IORedis;
  let namespace: string;
  const relays: Relay[] = [];

  beforeAll(() => {
    admin = new IORedis(redisHost);
  });

  afterEach(async () => {
    await Promise.all(relays.splice(0).map(relay => relay.close()));
    const keys = await admin.keys(`${prefix}:relay:${namespace}:*`);
    if (keys.length > 0) {
      await admin.del(...keys);
    }
  });

  afterAll(async () => {
    await admin.quit();
  });

  const newRelay = async () => {
    const relay = new Relay({
      connection: { host: redisHost },
      prefix,
      namespace,
    });
    relays.push(relay);
    await relay.waitUntilReady();
    return relay;
  };

  it('delivers messages published while its inbox connection was dropped', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const subscriber = await newRelay();
    const publisher = await newRelay();
    const received: unknown[] = [];
    subscriber.on('error', () => undefined);
    await subscriber.subscribe('jobs.*.cancel', message => {
      received.push(message.data);
    });

    // Kill every connection currently blocked reading this namespace's inboxes,
    // as a network failure would.
    const inboxKey = `${prefix}:relay:${namespace}:inbox:${subscriber.nodeId}`;
    await waitFor(async () => {
      const clients = (await admin.client('LIST')) as string;
      return clients.includes('cmd=xread');
    });
    const clients = ((await admin.client('LIST')) as string)
      .split('\n')
      .filter(line => line.includes('cmd=xread'));
    for (const line of clients) {
      const id = /id=(\d+)/.exec(line)![1];
      await admin.client('KILL', 'ID', id);
    }

    // Published while the reader is reconnecting: kept in the inbox stream.
    for (let i = 0; i < 3; i++) {
      await publisher.publish(`jobs.${i}.cancel`, i);
    }
    expect(await admin.xlen(inboxKey)).toBe(3);

    await waitFor(() => received.length === 3, 8000);
    expect(received).toEqual([0, 1, 2]);
  });

  it('leaves no keys behind when nodes close', async () => {
    namespace = `t-${randomUUID().slice(0, 13)}`;
    const relay = await newRelay();
    await relay.subscribe('a.*', () => undefined);
    await relay.subscribe('b.>', () => undefined);
    await relay.publish('a.1', 'x');
    await relay.close();

    const keys = await admin.keys(`${prefix}:relay:${namespace}:*`);
    expect(keys.sort()).toEqual([`${prefix}:relay:${namespace}:mid`]);
  });
});
