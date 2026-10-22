import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import { Relay, RelayMessage } from '../src';
import { relayTestHarness, waitFor } from './utils/relay';

/**
 * Relay stress tests: correctness under concurrent load. Backend-agnostic,
 * like the main relay tests.
 */
const ctx = relayTestHarness('stress');

describe(`Relay stress (${ctx.backend})`, () => {
  beforeAll(() => ctx.setup());
  afterAll(() => ctx.teardown());

  const relays: Relay<any>[] = [];
  const namespaces: string[] = [];

  const newNamespace = () => {
    const namespace = `s-${randomUUID().slice(0, 13)}`;
    namespaces.push(namespace);
    return namespace;
  };
  const newRelay = async (namespace: string) => {
    const relay = ctx.createRelay({ namespace });
    relays.push(relay);
    await relay.waitUntilReady();
    return relay;
  };

  afterEach(async () => {
    await Promise.all(relays.splice(0).map(relay => relay.close()));
    await Promise.all(namespaces.splice(0).map(ns => ctx.cleanup(ns)));
  });

  /** Asserts that each publisher's messages arrived once, in order. */
  const expectInOrder = (
    received: RelayMessage<{ p: number; seq: number }>[],
    publishers: number[],
    perPublisher: number,
  ) => {
    for (const p of publishers) {
      const seqs = received.filter(m => m.data.p === p).map(m => m.data.seq);
      expect(seqs).toEqual(Array.from({ length: perPublisher }, (_, i) => i));
    }
    expect(received).toHaveLength(publishers.length * perPublisher);
  };

  it('delivers every message once and in publisher order with concurrent publishers', async () => {
    const ns = newNamespace();
    const PUBLISHERS = 4;
    const PER_PUBLISHER = 300;

    const wildcard: RelayMessage<any>[][] = [];
    const exact: RelayMessage<any>[][] = [];
    for (let n = 0; n < 4; n++) {
      const node = await newRelay(ns);
      const all: RelayMessage<any>[] = [];
      const first: RelayMessage<any>[] = [];
      wildcard.push(all);
      exact.push(first);
      await node.subscribe('stress.*.events', m => {
        all.push(m);
      });
      await node.subscribe('stress.p0.events', m => {
        first.push(m);
      });
    }

    const publishers = await Promise.all(
      Array.from({ length: PUBLISHERS }, () => newRelay(ns)),
    );
    await Promise.all(
      publishers.map(async (publisher, p) => {
        for (let seq = 0; seq < PER_PUBLISHER; seq++) {
          await publisher.publish(`stress.p${p}.events`, { p, seq });
        }
      }),
    );

    const total = PUBLISHERS * PER_PUBLISHER;
    await waitFor(
      () =>
        wildcard.every(r => r.length >= total) &&
        exact.every(r => r.length >= PER_PUBLISHER),
      20_000,
    );
    await new Promise(resolve => setTimeout(resolve, 100));
    for (const received of wildcard) {
      expectInOrder(received, [0, 1, 2, 3], PER_PUBLISHER);
    }
    for (const received of exact) {
      expectInOrder(received, [0], PER_PUBLISHER);
    }
  }, 30_000);

  it('keeps delivering to stable nodes while other nodes join and leave', async () => {
    const ns = newNamespace();
    const MESSAGES = 600;
    const errors: Error[] = [];

    const stable = await newRelay(ns);
    stable.on('error', err => errors.push(err));
    const received: RelayMessage<any>[] = [];
    await stable.subscribe('churn.topic', m => {
      received.push(m);
    });
    const publisher = await newRelay(ns);
    publisher.on('error', err => errors.push(err));

    const publishing = (async () => {
      for (let seq = 0; seq < MESSAGES; seq++) {
        await publisher.publish('churn.topic', { p: 0, seq });
      }
    })();
    const churning = (async () => {
      for (let i = 0; i < 15; i++) {
        const transient = await newRelay(ns);
        await transient.subscribe('churn.topic', () => undefined);
        await transient.subscribe('churn.*', () => undefined);
        await transient.close();
      }
    })();
    await Promise.all([publishing, churning]);

    await waitFor(() => received.length >= MESSAGES, 20_000);
    await new Promise(resolve => setTimeout(resolve, 100));
    expectInOrder(received, [0], MESSAGES);
    expect(errors).toEqual([]);
    // Only the stable subscription is left.
    expect(await ctx.countSubscriptions(ns)).toBe(1);
  }, 30_000);

  it('keeps subscriptions consistent under subscribe/unsubscribe churn', async () => {
    const ns = newNamespace();
    const MESSAGES = 200;
    const node = await newRelay(ns);
    const publisher = await newRelay(ns);

    const longLived: RelayMessage<any>[][] = [];
    for (let i = 0; i < 20; i++) {
      for (const pattern of ['mix.x', 'mix.*']) {
        const received: RelayMessage<any>[] = [];
        longLived.push(received);
        await node.subscribe(pattern, m => {
          received.push(m);
        });
      }
    }

    const publishing = (async () => {
      for (let seq = 0; seq < MESSAGES; seq++) {
        await publisher.publish('mix.x', { p: 0, seq });
      }
    })();
    const churning = Promise.all(
      Array.from({ length: 200 }, async (_, i) => {
        const subscription = await node.subscribe(
          i % 2 ? 'mix.x' : 'mix.*',
          () => undefined,
        );
        await subscription.unsubscribe();
      }),
    );
    await Promise.all([publishing, churning]);

    await waitFor(() => longLived.every(r => r.length >= MESSAGES), 20_000);
    await new Promise(resolve => setTimeout(resolve, 100));
    for (const received of longLived) {
      expectInOrder(received, [0], MESSAGES);
    }
    expect(await ctx.countSubscriptions(ns)).toBe(40);
  }, 30_000);
});
