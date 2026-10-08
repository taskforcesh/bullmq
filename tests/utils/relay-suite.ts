import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'crypto';
import {
  IRelayBackend,
  Relay,
  RelayError,
  RelayErrorCode,
  RelayMessage,
  RelayOptions,
} from '../../src';

/**
 * Backend-agnostic relay test suite. Run against every relay backend (Redis
 * and PostgreSQL) so their Lua scripts and SQL functions are held to exactly
 * the same behaviour.
 */
export interface RelaySuiteContext {
  createBackend(namespace: string): IRelayBackend;
  createRelay(
    opts: Partial<RelayOptions<any>> & { namespace: string },
  ): Relay<any>;
  /** Number of stored subscriptions in a namespace (to check cleanup). */
  countSubscriptions(namespace: string): Promise<number>;
  /** Removes whatever a test left in the datastore for a namespace. */
  cleanup(namespace: string): Promise<void>;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeout = 3000,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeout) {
      throw new Error('waitFor timed out');
    }
    await delay(10);
  }
}

/** Independent reference implementation of the topic grammar. */
const SEGMENT_RE = /^[A-Za-z0-9_:%-]+$/;
function referenceParse(value: string, wildcards: boolean): string[] | null {
  if (value.length === 0 || Buffer.byteLength(value) > 512) {
    return null;
  }
  const segments = value.split('.');
  if (segments.length > 16) {
    return null;
  }
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (wildcards && s === '*') {
      continue;
    }
    if (wildcards && s === '>') {
      if (i !== segments.length - 1) {
        return null;
      }
      continue;
    }
    if (!SEGMENT_RE.test(s)) {
      return null;
    }
  }
  return segments;
}
function referenceMatch(pattern: string, topic: string): boolean {
  const p = pattern.split('.');
  const t = topic.split('.');
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '>') {
      return t.length > i;
    }
    if (i >= t.length || (p[i] !== '*' && p[i] !== t[i])) {
      return false;
    }
  }
  return p.length === t.length;
}

const VALID_PATTERNS = [
  'a',
  'a.b',
  'a.*',
  'a.>',
  '*.b',
  '*',
  '>',
  '*.*',
  'a.*.c',
  'a.b.>',
  '*.>',
  'q-1.jobs.%2E.progress',
  'x:y.z_1',
];
const TOPICS = [
  'a',
  'b',
  'a.b',
  'a.c',
  'a.b.c',
  'a.b.c.d',
  'x.b',
  'q-1.jobs.%2E.progress',
  'x:y.z_1',
];
const INVALID_TOPICS = [
  '',
  '.',
  'a.',
  '.a',
  'a..b',
  'a b',
  'a.b/c',
  'a.*',
  'a.>',
  'ä',
  'a.$conn',
  '$conn.x1',
  '$1.a',
  '$.a',
  'a'.repeat(513),
  Array.from({ length: 17 }, () => 'a').join('.'),
];
const INVALID_PATTERNS = [
  '',
  'a..b',
  'a.>.c',
  '>.a',
  'a.b*',
  'a.>>',
  'a b',
  '$conn.*',
  Array.from({ length: 17 }, () => '*').join('.'),
];

async function expectRelayError(
  promise: Promise<unknown>,
  code: RelayErrorCode,
): Promise<void> {
  const err = await promise.then(
    () => undefined,
    e => e,
  );
  expect(err).toBeInstanceOf(RelayError);
  expect((err as RelayError).code).toBe(code);
}

export function describeRelay(name: string, ctx: RelaySuiteContext): void {
  describe(`Relay (${name})`, () => {
    const backends: IRelayBackend[] = [];
    const relays: Relay<any>[] = [];
    const namespaces: string[] = [];

    const newNamespace = () => {
      const namespace = `t-${randomUUID().slice(0, 13)}`;
      namespaces.push(namespace);
      return namespace;
    };
    const newBackend = async (namespace: string) => {
      const backend = ctx.createBackend(namespace);
      backends.push(backend);
      await backend.waitUntilReady();
      return backend;
    };
    const newRelay = async (
      opts: Partial<RelayOptions<any>> & { namespace: string },
    ) => {
      const relay = ctx.createRelay(opts);
      relays.push(relay);
      await relay.waitUntilReady();
      return relay;
    };
    const readAll = async (
      backend: IRelayBackend,
      node: string,
      cursor?: string,
    ) =>
      backend.readInbox(node, cursor ?? backend.initialInboxCursor, {
        blockMs: 0,
        count: 1000,
      });

    afterEach(async () => {
      await Promise.all(relays.splice(0).map(relay => relay.close()));
      await Promise.all(backends.splice(0).map(backend => backend.close()));
      await Promise.all(namespaces.splice(0).map(ns => ctx.cleanup(ns)));
    });

    describe('backend contract', () => {
      it('registers nodes and renews their lease', async () => {
        const backend = await newBackend(newNamespace());
        await backend.registerNode('n1', 30_000);
        await backend.registerNode('n1', 30_000);
        expect(await backend.heartbeat('n1', 30_000)).toBe(true);
        expect(await backend.heartbeat('unknown', 30_000)).toBe(false);
        expect(await backend.unregisterNode('n1')).toBe(true);
        expect(await backend.unregisterNode('n1')).toBe(false);
        expect(await backend.heartbeat('n1', 30_000)).toBe(false);
      });

      it('validates node and endpoint ids', async () => {
        const backend = await newBackend(newNamespace());
        for (const id of ['', 'a b', 'a/b', 'a,b', 'a:b', 'x'.repeat(65)]) {
          await expectRelayError(
            backend.registerNode(id, 1000),
            RelayErrorCode.InvalidId,
          );
        }
        await backend.registerNode('x'.repeat(64), 1000);
        await backend.registerNode('n1', 30_000);
        await expectRelayError(
          backend.subscribe('n1', 'bad,id', 'a'),
          RelayErrorCode.InvalidId,
        );
      });

      it('rejects subscriptions of unregistered nodes', async () => {
        const backend = await newBackend(newNamespace());
        await expectRelayError(
          backend.subscribe('ghost', 'e1', 'a.b'),
          RelayErrorCode.NodeNotRegistered,
        );
      });

      it.each(INVALID_PATTERNS)(
        'rejects the invalid pattern %j',
        async pattern => {
          const backend = await newBackend(newNamespace());
          await backend.registerNode('n1', 30_000);
          await expectRelayError(
            backend.subscribe('n1', 'e1', pattern),
            RelayErrorCode.InvalidPattern,
          );
          expect(referenceParse(pattern, true)).toBeNull();
        },
      );

      it.each(INVALID_TOPICS)(
        'rejects publishing to the invalid topic %j',
        async topic => {
          const backend = await newBackend(newNamespace());
          await expectRelayError(
            backend.publish(topic, '1', { ts: 1, retainMs: 0, maxSize: 1000 }),
            RelayErrorCode.InvalidTopic,
          );
          expect(referenceParse(topic, false)).toBeNull();
        },
      );

      it('accepts the longest and deepest valid topics', async () => {
        const backend = await newBackend(newNamespace());
        const long = 'a'.repeat(512);
        const deep = Array.from({ length: 16 }, () => 'a').join('.');
        for (const topic of [long, deep]) {
          const result = await backend.publish(topic, '1', {
            ts: 1,
            retainMs: 0,
            maxSize: 10,
          });
          expect(result.nodes).toBe(0);
        }
      });

      it('subscribes and removes endpoints idempotently', async () => {
        const ns = newNamespace();
        const backend = await newBackend(ns);
        await backend.registerNode('n1', 30_000);
        expect((await backend.subscribe('n1', 'e1', 'a.*')).added).toBe(true);
        expect((await backend.subscribe('n1', 'e1', 'a.*')).added).toBe(false);
        expect(await ctx.countSubscriptions(ns)).toBe(1);
        expect(await backend.removeEndpoint('n1', 'e1')).toBe(1);
        expect(await backend.removeEndpoint('n1', 'e1')).toBe(0);
        expect(await ctx.countSubscriptions(ns)).toBe(0);
      });

      it('routes every topic to exactly the matching patterns', async () => {
        const backend = await newBackend(newNamespace());
        await backend.registerNode('n1', 30_000);
        const endpointFor = new Map<string, string>();
        for (const [index, pattern] of VALID_PATTERNS.entries()) {
          expect(referenceParse(pattern, true)).not.toBeNull();
          endpointFor.set(`e${index}`, pattern);
          await backend.subscribe('n1', `e${index}`, pattern);
        }
        let cursor = backend.initialInboxCursor;
        for (const topic of TOPICS) {
          const expected = [...endpointFor.entries()]
            .filter(([, pattern]) => referenceMatch(pattern, topic))
            .map(([endpoint]) => endpoint)
            .sort();
          const result = await backend.publish(topic, JSON.stringify(topic), {
            ts: 1,
            retainMs: 0,
            maxSize: 1000,
          });
          expect(result.endpoints).toBe(expected.length);
          expect(result.nodes).toBe(expected.length > 0 ? 1 : 0);

          const batch = await readAll(backend, 'n1', cursor);
          cursor = batch.cursor;
          if (expected.length === 0) {
            expect(batch.entries).toHaveLength(0);
          } else {
            expect(batch.entries).toHaveLength(1);
            expect(batch.entries[0].topic).toBe(topic);
            expect([...batch.entries[0].endpoints].sort()).toEqual(expected);
          }
        }
      });

      it('lists each endpoint once even when several of its patterns match', async () => {
        const backend = await newBackend(newNamespace());
        await backend.registerNode('n1', 30_000);
        for (const pattern of ['a.b', 'a.*', 'a.>', '>']) {
          await backend.subscribe('n1', 'e1', pattern);
        }
        await backend.subscribe('n1', 'e2', 'a.b');
        const result = await backend.publish('a.b', '"x"', {
          ts: 1,
          retainMs: 0,
          maxSize: 100,
        });
        expect(result).toMatchObject({ nodes: 1, endpoints: 2 });
        const { entries } = await readAll(backend, 'n1');
        expect(entries).toHaveLength(1);
        expect([...entries[0].endpoints].sort()).toEqual(['e1', 'e2']);
      });

      it('appends one entry per node, each with its own endpoints', async () => {
        const backend = await newBackend(newNamespace());
        for (const node of ['n1', 'n2', 'n3']) {
          await backend.registerNode(node, 30_000);
        }
        await backend.subscribe('n1', 'e1', 'orders.*');
        await backend.subscribe('n2', 'e2', 'orders.>');
        await backend.subscribe('n2', 'e3', 'orders.42');
        await backend.subscribe('n3', 'e4', 'invoices.*');
        const result = await backend.publish('orders.42', '{}', {
          ts: 123,
          retainMs: 0,
          maxSize: 100,
        });
        expect(result).toMatchObject({ nodes: 2, endpoints: 3 });

        const n1 = (await readAll(backend, 'n1')).entries;
        const n2 = (await readAll(backend, 'n2')).entries;
        const n3 = (await readAll(backend, 'n3')).entries;
        expect(n1.map(e => e.endpoints)).toEqual([['e1']]);
        expect(n2.map(e => [...e.endpoints].sort())).toEqual([['e2', 'e3']]);
        expect(n3).toHaveLength(0);
        expect(n1[0]).toMatchObject({
          kind: 'msg',
          topic: 'orders.42',
          mid: result.mid,
          ts: 123,
          data: '{}',
        });
        expect(n2[0].mid).toBe(result.mid);
      });

      it('assigns increasing message ids', async () => {
        const backend = await newBackend(newNamespace());
        const mids: number[] = [];
        for (let i = 0; i < 5; i++) {
          const { mid } = await backend.publish('a', '1', {
            ts: 1,
            retainMs: 0,
            maxSize: 10,
          });
          mids.push(Number(mid));
        }
        expect(mids).toEqual([...mids].sort((x, y) => x - y));
        expect(new Set(mids).size).toBe(5);
      });

      it('passes data through byte for byte', async () => {
        const backend = await newBackend(newNamespace());
        await backend.registerNode('n1', 30_000);
        await backend.subscribe('n1', 'e1', 'a');
        const values = [
          '',
          'plain',
          'with,commas,and "quotes"',
          '{"nested":{"emoji":"😀","accents":"áéí"}}',
          'line\nbreak\ttab\\backslash',
        ];
        for (const value of values) {
          await backend.publish('a', value, {
            ts: 1,
            retainMs: 0,
            maxSize: 1000,
          });
        }
        const { entries } = await readAll(backend, 'n1');
        expect(entries.map(e => e.data)).toEqual(values);
      });

      it('enforces the max data size in bytes', async () => {
        const backend = await newBackend(newNamespace());
        const opts = { ts: 1, retainMs: 0, maxSize: 4 };
        await backend.publish('a', 'abcd', opts);
        await expectRelayError(
          backend.publish('a', 'abcde', opts),
          RelayErrorCode.DataTooLarge,
        );
        // "éé" is 4 bytes, "ééé" is 6.
        await backend.publish('a', 'éé', opts);
        await expectRelayError(
          backend.publish('a', 'ééé', opts),
          RelayErrorCode.DataTooLarge,
        );
      });

      it('keeps inbox entries until the next read acknowledges them', async () => {
        const backend = await newBackend(newNamespace());
        await backend.registerNode('n1', 30_000);
        await backend.subscribe('n1', 'e1', 'a');
        for (let i = 0; i < 20; i++) {
          await backend.publish('a', String(i), {
            ts: 1,
            retainMs: 0,
            maxSize: 10,
          });
        }
        const read = (cursor: string) =>
          backend.readInbox('n1', cursor, { blockMs: 0, count: 7 });

        const first = await read(backend.initialInboxCursor);
        expect(first.entries.map(e => e.data)).toEqual([
          '0',
          '1',
          '2',
          '3',
          '4',
          '5',
          '6',
        ]);

        // Reading again from the same position returns the same entries.
        const again = await read(backend.initialInboxCursor);
        expect(again.entries.map(e => e.data)).toEqual(
          first.entries.map(e => e.data),
        );

        const received: string[] = [];
        let cursor = first.cursor;
        for (let i = 0; i < 5; i++) {
          const batch = await read(cursor);
          received.push(...batch.entries.map(e => e.data));
          cursor = batch.cursor;
        }
        expect(received).toEqual(
          Array.from({ length: 13 }, (_, i) => String(i + 7)),
        );
      });

      it('waits for new entries when the inbox is empty', async () => {
        const backend = await newBackend(newNamespace());
        await backend.registerNode('n1', 30_000);
        await backend.subscribe('n1', 'e1', 'a');

        const start = Date.now();
        const empty = await backend.readInbox(
          'n1',
          backend.initialInboxCursor,
          {
            blockMs: 200,
            count: 10,
          },
        );
        expect(empty.entries).toHaveLength(0);
        expect(Date.now() - start).toBeGreaterThanOrEqual(150);

        const publisher = await newBackend(backend.namespace);
        const pending = backend.readInbox('n1', empty.cursor, {
          blockMs: 5000,
          count: 10,
        });
        await delay(100);
        const published = Date.now();
        await publisher.publish('a', '"late"', {
          ts: 1,
          retainMs: 0,
          maxSize: 100,
        });
        const batch = await pending;
        expect(batch.entries.map(e => e.data)).toEqual(['"late"']);
        expect(Date.now() - published).toBeLessThan(2000);
      });

      it('returns retained messages only to exact subscriptions', async () => {
        const backend = await newBackend(newNamespace());
        await backend.registerNode('n1', 30_000);
        const first = await backend.publish('jobs.1.progress', '10', {
          ts: 5,
          retainMs: 60_000,
          maxSize: 100,
        });
        const second = await backend.publish('jobs.1.progress', '20', {
          ts: 6,
          retainMs: 60_000,
          maxSize: 100,
        });
        expect(Number(second.mid)).toBeGreaterThan(Number(first.mid));

        const exact = await backend.subscribe('n1', 'e1', 'jobs.1.progress');
        expect(exact.retained).toEqual({ mid: second.mid, ts: 6, data: '20' });
        const wildcard = await backend.subscribe('n1', 'e2', 'jobs.*.progress');
        expect(wildcard.retained).toBeUndefined();
        const other = await backend.subscribe('n1', 'e3', 'jobs.2.progress');
        expect(other.retained).toBeUndefined();

        // Not retained: does not replace the retained value.
        await backend.publish('jobs.1.progress', '30', {
          ts: 7,
          retainMs: 0,
          maxSize: 100,
        });
        const later = await backend.subscribe('n1', 'e4', 'jobs.1.progress');
        expect(later.retained?.data).toBe('20');
      });

      it('expires retained messages', async () => {
        const backend = await newBackend(newNamespace());
        await backend.registerNode('n1', 30_000);
        await backend.publish('status', '"up"', {
          ts: 1,
          retainMs: 100,
          maxSize: 100,
        });
        await delay(250);
        const result = await backend.subscribe('n1', 'e1', 'status');
        expect(result.retained).toBeUndefined();
      });

      it('removes every subscription of an endpoint', async () => {
        const ns = newNamespace();
        const backend = await newBackend(ns);
        await backend.registerNode('n1', 30_000);
        for (const pattern of ['a', 'a.*', 'b.>']) {
          await backend.subscribe('n1', 'e1', pattern);
        }
        await backend.subscribe('n1', 'e2', 'a');
        expect(await backend.removeEndpoint('n1', 'e1')).toBe(3);
        expect(await backend.removeEndpoint('n1', 'e1')).toBe(0);
        expect(await ctx.countSubscriptions(ns)).toBe(1);
        const result = await backend.publish('a', '1', {
          ts: 1,
          retainMs: 0,
          maxSize: 10,
        });
        expect(result).toMatchObject({ nodes: 1, endpoints: 1 });
      });

      it('unregistering a node removes its subscriptions and inbox', async () => {
        const ns = newNamespace();
        const backend = await newBackend(ns);
        await backend.registerNode('n1', 30_000);
        await backend.subscribe('n1', 'e1', 'a');
        await backend.publish('a', '1', { ts: 1, retainMs: 0, maxSize: 10 });
        await backend.unregisterNode('n1');
        expect(await ctx.countSubscriptions(ns)).toBe(0);
        const result = await backend.publish('a', '1', {
          ts: 1,
          retainMs: 0,
          maxSize: 10,
        });
        expect(result).toMatchObject({ nodes: 0, endpoints: 0 });

        await backend.registerNode('n1', 30_000);
        expect((await readAll(backend, 'n1')).entries).toHaveLength(0);
      });

      it('skips nodes whose lease expired, and sweeps them', async () => {
        const ns = newNamespace();
        const backend = await newBackend(ns);
        await backend.registerNode('short', 100);
        await backend.registerNode('long', 30_000);
        await backend.subscribe('short', 'e1', 'a');
        await backend.subscribe('long', 'e2', 'a');
        await delay(250);

        // Expired but not swept yet: no longer receives.
        const before = await backend.publish('a', '1', {
          ts: 1,
          retainMs: 0,
          maxSize: 10,
        });
        expect(before).toMatchObject({ nodes: 1, endpoints: 1 });

        expect(await backend.sweep(100)).toEqual(['short']);
        expect(await backend.sweep(100)).toEqual([]);
        expect(await ctx.countSubscriptions(ns)).toBe(1);
        expect(await backend.heartbeat('short', 30_000)).toBe(false);
        expect(await backend.heartbeat('long', 30_000)).toBe(true);
      });

      it('a heartbeat before the sweep revives an expired node', async () => {
        const backend = await newBackend(newNamespace());
        await backend.registerNode('n1', 100);
        await backend.subscribe('n1', 'e1', 'a');
        await delay(250);
        expect(await backend.heartbeat('n1', 30_000)).toBe(true);
        expect(await backend.sweep(100)).toEqual([]);
        const result = await backend.publish('a', '1', {
          ts: 1,
          retainMs: 0,
          maxSize: 10,
        });
        expect(result.endpoints).toBe(1);
      });

      it('sweeps at most the given number of nodes per call', async () => {
        const backend = await newBackend(newNamespace());
        for (let i = 0; i < 5; i++) {
          await backend.registerNode(`n${i}`, 50);
        }
        await delay(200);
        expect(await backend.sweep(2)).toHaveLength(2);
        expect(await backend.sweep(10)).toHaveLength(3);
      });

      it('keeps subscriptions consistent under concurrent changes', async () => {
        const ns = newNamespace();
        const backend = await newBackend(ns);
        await backend.registerNode('n1', 30_000);
        const endpoints = Array.from({ length: 50 }, (_, i) => `e${i}`);
        await Promise.all(
          endpoints.map(e => backend.subscribe('n1', e, 'hot.*')),
        );
        let result = await backend.publish('hot.x', '1', {
          ts: 1,
          retainMs: 0,
          maxSize: 10,
        });
        expect(result.endpoints).toBe(50);

        await Promise.all(endpoints.map(e => backend.removeEndpoint('n1', e)));
        expect(await ctx.countSubscriptions(ns)).toBe(0);
        result = await backend.publish('hot.x', '1', {
          ts: 1,
          retainMs: 0,
          maxSize: 10,
        });
        expect(result.endpoints).toBe(0);
      });

      it('isolates namespaces', async () => {
        const a = await newBackend(newNamespace());
        const b = await newBackend(newNamespace());
        await a.registerNode('n1', 30_000);
        await b.registerNode('n1', 30_000);
        await a.subscribe('n1', 'e1', 'shared');
        const result = await b.publish('shared', '1', {
          ts: 1,
          retainMs: 0,
          maxSize: 10,
        });
        expect(result.nodes).toBe(0);
        expect((await readAll(a, 'n1')).entries).toHaveLength(0);
      });
    });

    describe('Relay', () => {
      it('validates its options', () => {
        expect(() => ctx.createRelay({ namespace: 'bad namespace' })).toThrow(
          /Invalid relay namespace/,
        );
        expect(() =>
          ctx.createRelay({ namespace: 'ok', nodeId: 'a/b' }),
        ).toThrow(/Invalid relay nodeId/);
      });

      it('delivers messages between nodes, with JSON payloads', async () => {
        const ns = newNamespace();
        const subscriber = await newRelay({ namespace: ns });
        const publisher = await newRelay({ namespace: ns });
        const received: RelayMessage[] = [];
        await subscriber.subscribe('events.>', message => {
          received.push(message);
        });

        const values = [
          { a: 1, b: [true, null] },
          'text',
          42,
          false,
          null,
          undefined,
        ];
        const mids: string[] = [];
        for (const value of values) {
          mids.push((await publisher.publish('events.created', value)).mid);
        }
        await waitFor(() => received.length === values.length);
        expect(received.map(m => m.data)).toEqual([
          { a: 1, b: [true, null] },
          'text',
          42,
          false,
          null,
          null,
        ]);
        expect(received.map(m => m.mid)).toEqual(mids);
        expect(received[0]).toMatchObject({
          topic: 'events.created',
          retained: false,
        });
        expect(Object.keys(received[0]).sort()).toEqual([
          'data',
          'mid',
          'retained',
          'topic',
          'ts',
        ]);
      });

      it('gives each subscription its own copy', async () => {
        const ns = newNamespace();
        const relay = await newRelay({ namespace: ns });
        const first: string[] = [];
        const second: string[] = [];
        await relay.subscribe('a.*', m => {
          first.push(m.topic);
        });
        await relay.subscribe('a.>', m => {
          second.push(m.topic);
        });
        const result = await relay.publish('a.b', 1);
        expect(result).toMatchObject({ nodes: 1, endpoints: 2 });
        await waitFor(() => first.length === 1 && second.length === 1);
        await delay(50);
        expect(first).toEqual(['a.b']);
        expect(second).toEqual(['a.b']);
      });

      it('delivers messages in publish order', async () => {
        const ns = newNamespace();
        const subscriber = await newRelay({ namespace: ns });
        const publisher = await newRelay({ namespace: ns });
        const received: number[] = [];
        await subscriber.subscribe('seq', m => {
          received.push(m.data as number);
        });
        for (let i = 0; i < 150; i++) {
          await publisher.publish('seq', i);
        }
        await waitFor(() => received.length === 150, 5000);
        expect(received).toEqual(Array.from({ length: 150 }, (_, i) => i));
      });

      it('stops delivering after unsubscribe', async () => {
        const ns = newNamespace();
        const relay = await newRelay({ namespace: ns });
        const kept: unknown[] = [];
        const removed: unknown[] = [];
        await relay.subscribe('topic', m => {
          kept.push(m.data);
        });
        const subscription = await relay.subscribe('topic', m => {
          removed.push(m.data);
        });
        expect(subscription.pattern).toBe('topic');
        await subscription.unsubscribe();
        await subscription.unsubscribe();
        expect(await ctx.countSubscriptions(ns)).toBe(1);
        await relay.publish('topic', 'x');
        await waitFor(() => kept.length === 1);
        await delay(50);
        expect(removed).toEqual([]);
      });

      it('delivers the retained message first on exact subscriptions', async () => {
        const ns = newNamespace();
        const relay = await newRelay({ namespace: ns });
        await relay.publish('jobs.7.progress', 70, { retain: 60_000 });
        const exact: RelayMessage[] = [];
        const wildcard: RelayMessage[] = [];
        await relay.subscribe('jobs.7.progress', m => {
          exact.push(m);
        });
        await relay.subscribe('jobs.*.progress', m => {
          wildcard.push(m);
        });
        expect(exact).toHaveLength(1);
        expect(exact[0]).toMatchObject({
          data: 70,
          retained: true,
          topic: 'jobs.7.progress',
        });

        await relay.publish('jobs.7.progress', 80);
        await waitFor(() => exact.length === 2 && wildcard.length === 1);
        expect(exact[1]).toMatchObject({ data: 80, retained: false });
        expect(wildcard.map(m => m.data)).toEqual([80]);
      });

      it('rejects invalid topics and oversized messages', async () => {
        const relay = await newRelay({
          namespace: newNamespace(),
          maxMessageSize: 10,
        });
        await expectRelayError(
          relay.publish('a..b', 1),
          RelayErrorCode.InvalidTopic,
        );
        await expectRelayError(
          relay.publish('a', 'x'.repeat(20)),
          RelayErrorCode.DataTooLarge,
        );
        await expectRelayError(
          relay.subscribe('a.>.b', () => undefined),
          RelayErrorCode.InvalidPattern,
        );
      });

      it('a failed subscribe leaves nothing behind', async () => {
        const ns = newNamespace();
        const relay = await newRelay({ namespace: ns });
        await expect(
          relay.subscribe('bad..pattern', () => undefined),
        ).rejects.toThrow(RelayError);
        expect((relay as any).endpoints.size).toBe(0);
        expect(await ctx.countSubscriptions(ns)).toBe(0);
      });

      it('reports listener errors without stopping delivery', async () => {
        const ns = newNamespace();
        const relay = await newRelay({ namespace: ns });
        const errors: Error[] = [];
        relay.on('error', err => errors.push(err));
        const received: unknown[] = [];
        await relay.subscribe('a', () => {
          throw new Error('sync failure');
        });
        await relay.subscribe('a', async () => {
          throw new Error('async failure');
        });
        await relay.subscribe('a', m => {
          received.push(m.data);
        });
        await relay.publish('a', 1);
        await relay.publish('a', 2);
        await waitFor(() => received.length === 2 && errors.length === 4);
        expect(errors.map(e => e.message).sort()).toEqual([
          'async failure',
          'async failure',
          'sync failure',
          'sync failure',
        ]);
      });

      it('recovers its subscriptions after being swept', async () => {
        const ns = newNamespace();
        const relay = await newRelay({ namespace: ns, heartbeatInterval: 50 });
        const received: unknown[] = [];
        await relay.subscribe('orders.*', m => {
          received.push(m.data);
        });
        const recovered = new Promise(resolve =>
          relay.once('recovered', resolve),
        );

        // Simulates another node sweeping this one after a missed lease.
        const other = await newBackend(ns);
        await other.unregisterNode(relay.nodeId);
        expect(await ctx.countSubscriptions(ns)).toBe(0);

        await recovered;
        expect(await ctx.countSubscriptions(ns)).toBe(1);
        await other.publish('orders.1', '"back"', {
          ts: 1,
          retainMs: 0,
          maxSize: 100,
        });
        await waitFor(() => received.length === 1);
        expect(received).toEqual(['back']);
      });

      it('sweeps nodes that stopped renewing their lease', async () => {
        const ns = newNamespace();
        const crashed = await newBackend(ns);
        await crashed.registerNode('crashed', 100);
        await crashed.subscribe('crashed', 'e1', 'a');

        const relay = await newRelay({ namespace: ns, sweepInterval: 50 });
        const swept = await new Promise<string[]>(resolve =>
          relay.once('swept', resolve),
        );
        expect(swept).toEqual(['crashed']);
        expect(await ctx.countSubscriptions(ns)).toBe(0);
      });

      it('close() unregisters the node and rejects further use', async () => {
        const ns = newNamespace();
        const relay = await newRelay({ namespace: ns });
        await relay.subscribe('a', () => undefined);
        await relay.subscribe('b.*', () => undefined);
        expect(await ctx.countSubscriptions(ns)).toBe(2);
        await relay.close();
        await relay.close();
        expect(await ctx.countSubscriptions(ns)).toBe(0);
        await expect(relay.publish('a', 1)).rejects.toThrow('Relay is closed');
        await expect(relay.subscribe('a', () => undefined)).rejects.toThrow(
          'Relay is closed',
        );

        const other = await newRelay({ namespace: ns });
        const result = await other.publish('a', 1);
        expect(result.nodes).toBe(0);
      });

      it('close() returns promptly while the inbox read is blocked', async () => {
        const relay = await newRelay({
          namespace: newNamespace(),
          blockTimeout: 10_000,
        });
        await delay(50);
        const start = Date.now();
        await relay.close();
        expect(Date.now() - start).toBeLessThan(2000);
      });

      it('delivers to many subscribers across nodes', async () => {
        const ns = newNamespace();
        const nodes = await Promise.all(
          [0, 1, 2].map(() => newRelay({ namespace: ns })),
        );
        const counts = [0, 0, 0];
        for (const [index, relay] of nodes.entries()) {
          for (let i = 0; i < 4; i++) {
            await relay.subscribe('broadcast', () => {
              counts[index]++;
            });
          }
        }
        const result = await nodes[0].publish('broadcast', 'hi');
        expect(result).toMatchObject({ nodes: 3, endpoints: 12 });
        await waitFor(() => counts.every(count => count === 4));
      });
    });
  });
}
