import { describe, expect, it, vi } from 'vitest';
import { hostname } from 'os';
import {
  IRelayBackend,
  Relay,
  RelayInboxBatch,
  RelayNodeInfo,
  RelayPublishResult,
  RelaySubscribeResult,
} from '../src';
import { version } from '../src/version';
import { waitFor } from './utils/relay';

/**
 * Scriptable in-memory backend used to exercise the Relay's error handling,
 * which is hard to trigger against a real datastore.
 */
class FakeBackend implements IRelayBackend {
  readonly namespace = 'fake';
  readonly initialInboxCursor = '0';
  fail: Partial<Record<keyof IRelayBackend, Error>> = {};
  heartbeatResult = true;
  backlog = 0;
  trimmed: [string, string, number][] = [];
  inbox: RelayInboxBatch[] = [];
  calls: string[] = [];
  private wake?: () => void;

  private check(name: keyof IRelayBackend) {
    this.calls.push(name);
    if (this.fail[name]) {
      throw this.fail[name];
    }
  }
  async waitUntilReady() {
    this.check('waitUntilReady');
  }
  async close() {
    this.check('close');
  }
  registrations: RelayNodeInfo[] = [];
  async registerNode(_nodeId: string, _leaseMs: number, info?: RelayNodeInfo) {
    this.check('registerNode');
    this.registrations.push(info!);
  }
  async heartbeat() {
    this.check('heartbeat');
    return this.heartbeatResult;
  }
  async unregisterNode() {
    this.check('unregisterNode');
    return true;
  }
  async sweep() {
    this.check('sweep');
    return [];
  }
  async subscribe(): Promise<RelaySubscribeResult> {
    this.check('subscribe');
    return { added: true };
  }
  async removeEndpoint() {
    this.check('removeEndpoint');
    return 1;
  }
  async publish(): Promise<RelayPublishResult> {
    this.check('publish');
    return { mid: '1', nodes: 0, endpoints: 0 };
  }
  async readInbox(): Promise<RelayInboxBatch> {
    this.check('readInbox');
    const next = this.inbox.shift();
    if (next) {
      return next;
    }
    await new Promise<void>(resolve => {
      this.wake = resolve;
      setTimeout(resolve, 20);
    });
    return { entries: [], cursor: '0' };
  }
  async trimInbox(nodeId: string, cursor: string, maxLength: number) {
    this.check('trimInbox');
    this.trimmed.push([nodeId, cursor, maxLength]);
    return this.backlog;
  }
  async getCounts() {
    return { nodes: 0, subscriptions: 0, patterns: 0, retained: 0 };
  }
  async getNodes() {
    return [];
  }
  async getSubscriptions() {
    return [];
  }
  async getPatterns() {
    return [];
  }
  async getRetained() {
    return [];
  }
  async getNamespaces() {
    return [];
  }
  async getNodeConnections() {
    return [];
  }
  async deleteRetained() {
    return false;
  }
  interruptInbox() {
    this.wake?.();
  }
}

const createRelay = (backend: FakeBackend, opts = {}) =>
  new Relay({
    connection: {},
    namespace: 'fake',
    backend: () => backend,
    ...opts,
  });

describe('Relay resilience', () => {
  it('rejects a subscription completed after close without delivering retained data', async () => {
    const backend = new FakeBackend();
    let complete!: (result: RelaySubscribeResult) => void;
    backend.subscribe = vi.fn(
      () =>
        new Promise<RelaySubscribeResult>(resolve => {
          complete = resolve;
        }),
    );
    const relay = createRelay(backend);
    const listener = vi.fn();
    try {
      await relay.waitUntilReady();
      const subscribing = relay.subscribe('a', listener);
      await waitFor(() => !!complete);
      await relay.close();
      const rejected = expect(subscribing).rejects.toThrow('Relay is closed');
      complete({
        added: true,
        retained: { mid: '1', ts: 1, data: '"retained"' },
      });
      await rejected;
      expect(listener).not.toHaveBeenCalled();
    } finally {
      await relay.close();
    }
  });

  it('requires a connection', () => {
    expect(() => new Relay(undefined as any)).toThrow(
      'Relay requires a connection',
    );
    expect(() => new Relay({} as any)).toThrow('Relay requires a connection');
  });

  it.each([
    'leaseDuration',
    'heartbeatInterval',
    'sweepInterval',
    'blockTimeout',
    'inboxMaxLength',
    'maxMessageSize',
  ])('rejects invalid %s before creating a backend', name => {
    const backend = new FakeBackend();
    const factory = vi.fn(() => backend);
    for (const value of [0, -1, 0.5, NaN, Infinity, 2_147_483_648]) {
      expect(() =>
        createRelay(backend, { [name]: value, backend: factory }),
      ).toThrow(`Invalid relay ${name}`);
    }
    expect(factory).not.toHaveBeenCalled();
    expect(backend.calls).toEqual([]);
  });

  it.each([1, 2_147_483_647])(
    'accepts positive integer option boundaries (%i)',
    async value => {
      const backend = new FakeBackend();
      const relay = createRelay(backend, {
        blockTimeout: value,
        inboxMaxLength: value,
        maxMessageSize: value,
      });
      try {
        await relay.waitUntilReady();
        await expect(relay.publish('a', 1)).resolves.toMatchObject({
          mid: '1',
        });
      } finally {
        await relay.close();
      }
    },
  );

  it.each([{ lagThreshold: 10_001 }, { inboxMaxLength: 10, lagThreshold: 11 }])(
    'rejects a lag threshold above the inbox cap (%j)',
    opts => {
      const backend = new FakeBackend();
      const factory = vi.fn(() => backend);
      expect(() => createRelay(backend, { ...opts, backend: factory })).toThrow(
        'Relay lagThreshold must not exceed inboxMaxLength',
      );
      expect(factory).not.toHaveBeenCalled();
      expect(backend.calls).toEqual([]);
    },
  );

  it.each([1, 10_000])(
    'accepts a lag threshold equal to the inbox cap (%i)',
    async inboxMaxLength => {
      const backend = new FakeBackend();
      const relay = createRelay(backend, {
        inboxMaxLength,
        lagThreshold: inboxMaxLength,
      });
      const lag = vi.fn();
      relay.on('lag', lag);
      try {
        await relay.waitUntilReady();
        backend.backlog = inboxMaxLength;
        (relay as any).batchInFlight = false;
        await (relay as any).checkBacklog();
        expect(lag).toHaveBeenCalledExactlyOnceWith(inboxMaxLength);
      } finally {
        await relay.close();
      }
    },
  );

  it.each([-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid retention (%s) before publishing',
    async retain => {
      const backend = new FakeBackend();
      const publish = vi.spyOn(backend, 'publish');
      const relay = createRelay(backend);
      try {
        await expect(relay.publish('a', 1, { retain })).rejects.toThrow(
          'Invalid relay retain',
        );
        expect(publish).not.toHaveBeenCalled();
      } finally {
        await relay.close();
      }
    },
  );

  it.each([undefined, 0, 1, Number.MAX_SAFE_INTEGER])(
    'accepts retention boundaries (%s)',
    async retain => {
      const backend = new FakeBackend();
      const publish = vi.spyOn(backend, 'publish');
      const relay = createRelay(backend);
      try {
        await relay.publish('a', 1, { retain });
        expect(publish).toHaveBeenCalledExactlyOnceWith(
          'a',
          '1',
          expect.objectContaining({ retainMs: retain ?? 0 }),
        );
      } finally {
        await relay.close();
      }
    },
  );

  it.each([1, 2])(
    'clamps the default heartbeat for a %i ms lease',
    async leaseDuration => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const backend = new FakeBackend();
      const relay = createRelay(backend, { leaseDuration });
      try {
        await relay.waitUntilReady();
        expect(setIntervalSpy).toHaveBeenNthCalledWith(
          1,
          expect.any(Function),
          1,
        );
        await vi.advanceTimersByTimeAsync(1);
        expect(backend.calls.filter(call => call === 'heartbeat')).toHaveLength(
          1,
        );
      } finally {
        await relay.close();
        setIntervalSpy.mockRestore();
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    },
  );

  it.each(['waitUntilReady', 'registerNode'] as const)(
    'does not start timers when closed during %s',
    async method => {
      vi.useFakeTimers();
      const backend = new FakeBackend();
      let resume!: () => void;
      backend[method] = () =>
        new Promise<void>(resolve => {
          resume = resolve;
        });
      const relay = createRelay(backend);
      try {
        for (let i = 0; i < 100 && !resume; i++) {
          await Promise.resolve();
        }
        const closing = relay.close();
        resume();
        await closing;
        expect(vi.getTimerCount()).toBe(0);
        expect(backend.calls).not.toContain('readInbox');
        if (method === 'waitUntilReady') {
          // Cancelled before connecting: never registers.
          expect(backend.calls).not.toContain('registerNode');
          expect(backend.calls).not.toContain('unregisterNode');
        } else {
          expect(backend.calls).toContain('unregisterNode');
        }
        expect(backend.calls).toContain('close');
      } finally {
        resume();
        await relay.close();
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    },
  );

  it('closes while the datastore never becomes ready', async () => {
    const backend = new FakeBackend();
    backend.waitUntilReady = () => new Promise<void>(() => undefined);
    const relay = createRelay(backend);
    const errors: Error[] = [];
    relay.on('error', err => errors.push(err));
    await relay.close();
    await expect(relay.waitUntilReady()).resolves.toBeUndefined();
    await expect(relay.publish('a', 1)).rejects.toThrow('Relay is closed');
    expect(backend.calls).toEqual(['close']);
    expect(errors).toEqual([]);
  });

  it('delivers a retained baseline before an update received while subscribing', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend);
    const received: unknown[] = [];
    backend.subscribe = async () => {
      const endpoint = [...(relay as any).endpoints.keys()][0];
      backend.inbox.push({
        entries: [
          {
            kind: 'msg',
            topic: 'a',
            mid: '2',
            ts: 2,
            data: '"update"',
            endpoints: [endpoint],
          },
        ],
        cursor: '1',
      });
      await waitFor(
        () => (relay as any).endpoints.get(endpoint).pending.length === 1,
      );
      return { added: true, retained: { mid: '1', ts: 1, data: '"baseline"' } };
    };
    try {
      await relay.subscribe('a', message => {
        received.push([message.data, message.retained]);
      });
      expect(received).toEqual([
        ['baseline', true],
        ['update', false],
      ]);
    } finally {
      await relay.close();
    }
  });

  it('delivers every message buffered while subscribing, whatever their order', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend);
    const received: unknown[] = [];
    backend.subscribe = async () => {
      const endpoint = [...(relay as any).endpoints.keys()][0];
      // Publishes on different topics may commit out of message id order.
      backend.inbox.push({
        entries: [
          {
            kind: 'msg',
            topic: 'b',
            mid: '2',
            ts: 2,
            data: '"second"',
            endpoints: [endpoint],
          },
          {
            kind: 'msg',
            topic: 'a',
            mid: '1',
            ts: 1,
            data: '"first"',
            endpoints: [endpoint],
          },
        ],
        cursor: '1',
      });
      await waitFor(
        () => (relay as any).endpoints.get(endpoint).pending.length === 2,
      );
      return { added: true };
    };
    try {
      await relay.subscribe('*', message => {
        received.push(message.data);
      });
      expect(received).toEqual(['second', 'first']);
    } finally {
      await relay.close();
    }
  });

  it('reports a failed start', async () => {
    const backend = new FakeBackend();
    backend.fail.registerNode = new Error('datastore down');
    const relay = createRelay(backend);
    const errors: Error[] = [];
    relay.on('error', err => errors.push(err));
    await expect(relay.waitUntilReady()).rejects.toThrow('datastore down');
    await waitFor(() => errors.length === 1);
    await expect(relay.publish('a', 1)).rejects.toThrow('datastore down');
    await relay.close();
  });

  it('reports heartbeat and sweep failures and keeps running', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend, {
      heartbeatInterval: 10,
      sweepInterval: 10,
    });
    await relay.waitUntilReady();
    const errors: string[] = [];
    relay.on('error', err => errors.push(err.message));
    backend.fail.heartbeat = new Error('heartbeat failed');
    backend.fail.sweep = new Error('sweep failed');
    await waitFor(
      () =>
        errors.includes('heartbeat failed') && errors.includes('sweep failed'),
    );

    delete backend.fail.heartbeat;
    delete backend.fail.sweep;
    const before = backend.calls.length;
    await waitFor(
      () =>
        backend.calls.slice(before).includes('heartbeat') &&
        backend.calls.slice(before).includes('sweep'),
    );
    await relay.close();
  });

  it.each([
    ['9007199254740991', '9007199254740992', false],
    ['9007199254740992', '9007199254740993', false],
    ['9007199254740993', '9007199254740992', true],
    ['9007199254740993', '9007199254740993', false],
  ])(
    'delivers retained ID %s before newer live ID %s, without losing precision',
    async (liveMid, retainedMid, deliverLive) => {
      const backend = new FakeBackend();
      const relay = createRelay(backend);
      const listener = vi.fn();
      backend.subscribe = async () => {
        const endpoint = [...(relay as any).endpoints.keys()][0];
        backend.inbox.push({
          entries: [
            {
              kind: 'msg',
              topic: 'a',
              mid: liveMid,
              ts: 1,
              data: '"live"',
              endpoints: [endpoint],
            },
          ],
          cursor: '1',
        });
        // The live message arrives while subscribing: it is buffered.
        await waitFor(
          () => (relay as any).endpoints.get(endpoint).pending.length === 1,
        );
        expect(listener).not.toHaveBeenCalled();
        return {
          added: true,
          retained: { mid: retainedMid, ts: 2, data: '"retained"' },
        };
      };
      try {
        await relay.subscribe('a', listener);
        expect(listener.mock.calls.map(([message]) => message)).toEqual([
          {
            topic: 'a',
            mid: retainedMid,
            ts: 2,
            data: 'retained',
            retained: true,
          },
          ...(deliverLive
            ? [
                {
                  topic: 'a',
                  mid: liveMid,
                  ts: 1,
                  data: 'live',
                  retained: false,
                },
              ]
            : []),
        ]);
      } finally {
        await relay.close();
      }
    },
  );

  it('retries the inbox after a read failure', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend);
    const errors: string[] = [];
    relay.on('error', err => errors.push(err.message));
    const received: unknown[] = [];
    await relay.waitUntilReady();
    await relay.subscribe('a', m => {
      received.push(m.data);
    });
    const endpoint = [...(relay as any).endpoints.keys()][0];

    backend.fail.readInbox = new Error('read failed');
    await waitFor(() => errors.includes('read failed'));
    delete backend.fail.readInbox;
    backend.inbox.push({
      entries: [
        {
          kind: 'msg',
          topic: 'a',
          mid: '5',
          ts: 1,
          data: '"after retry"',
          endpoints: [endpoint],
        },
      ],
      cursor: '1',
    });
    await waitFor(() => received.length === 1, 4000);
    expect(received).toEqual(['after retry']);
    await relay.close();
  });

  it('skips inbox entries of kinds it does not know', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend);
    const errors: Error[] = [];
    relay.on('error', err => errors.push(err));
    const received: unknown[] = [];
    await relay.waitUntilReady();
    await relay.subscribe('a', m => {
      received.push(m.data);
    });
    const endpoint = [...(relay as any).endpoints.keys()][0];
    backend.inbox.push({
      entries: [
        {
          kind: 'reply',
          topic: 'a',
          mid: '1',
          ts: 1,
          data: '"from a newer node"',
          endpoints: [endpoint],
        },
        {
          kind: 'msg',
          topic: 'a',
          mid: '2',
          ts: 1,
          data: '"ok"',
          endpoints: [endpoint],
        },
      ],
      cursor: '2',
    });
    await waitFor(() => received.length === 1);
    expect(received).toEqual(['ok']);
    expect(errors).toEqual([]);
    await relay.close();
  });

  it('registers with its name, host, pid and version', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend, { name: 'api' });
    await relay.waitUntilReady();
    expect(backend.registrations).toEqual([
      {
        name: 'api',
        host: hostname(),
        pid: process.pid,
        version,
      },
    ]);
    await relay.close();
  });

  it('validates the name and getter ranges', async () => {
    const backend = new FakeBackend();
    expect(() => createRelay(backend, { name: 'x'.repeat(257) })).toThrow(
      'Invalid relay name',
    );
    const relay = createRelay(backend, { name: 'x'.repeat(256) });
    await relay.waitUntilReady();
    for (const [start, end] of [
      [-1, 0],
      [0, -2],
      [0.5, 1],
    ]) {
      await expect(relay.getNodes(start, end)).rejects.toThrow(
        'Invalid relay range',
      );
    }
    await expect(relay.getNodes(0, -1)).resolves.toEqual([]);
    await relay.close();
  });

  it('reports undecodable payloads and keeps delivering', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend);
    const errors: Error[] = [];
    relay.on('error', err => errors.push(err));
    const received: unknown[] = [];
    await relay.waitUntilReady();
    await relay.subscribe('a', m => {
      received.push(m.data);
    });
    const endpoint = [...(relay as any).endpoints.keys()][0];
    backend.inbox.push({
      entries: [
        {
          kind: 'msg',
          topic: 'a',
          mid: '1',
          ts: 1,
          data: '{not json',
          endpoints: [endpoint],
        },
        {
          kind: 'msg',
          topic: 'a',
          mid: '2',
          ts: 1,
          data: '"ok"',
          endpoints: [endpoint],
        },
        {
          kind: 'msg',
          topic: 'a',
          mid: '3',
          ts: 1,
          data: '"gone"',
          endpoints: ['unknown'],
        },
      ],
      cursor: '3',
    });
    await waitFor(() => received.length === 1 && errors.length === 1);
    expect(received).toEqual(['ok']);
    expect(errors[0]).toBeInstanceOf(SyntaxError);
    await relay.close();
  });

  it('closes even if unregistering fails', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend);
    await relay.waitUntilReady();
    const errors: string[] = [];
    relay.on('error', err => errors.push(err.message));
    backend.fail.unregisterNode = new Error('unregister failed');
    await relay.close();
    expect(errors).toEqual(['unregister failed']);
    expect(backend.calls).toContain('close');
  });

  it('does not renew or sweep once closed', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend);
    await relay.waitUntilReady();
    await relay.close();
    const before = backend.calls.length;
    await (relay as any).heartbeat();
    await (relay as any).sweep();
    expect(backend.calls.length).toBe(before);
  });

  it('does not run two recoveries at once', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend);
    await relay.waitUntilReady();
    backend.heartbeatResult = false;
    await Promise.all([(relay as any).heartbeat(), (relay as any).heartbeat()]);
    const registrations = backend.calls.filter(c => c === 'registerNode');
    expect(registrations).toHaveLength(2); // start + one recovery
    await relay.close();
  });

  it('renews the lease while recovery restores subscriptions', async () => {
    vi.useFakeTimers();
    const backend = new FakeBackend();
    const relay = createRelay(backend, {
      heartbeatInterval: 100_000,
      leaseDuration: 30,
    });
    let resume!: () => void;
    let startSubscription!: () => void;
    const subscriptionStarted = new Promise<void>(resolve => {
      startSubscription = resolve;
    });
    try {
      await relay.waitUntilReady();
      await relay.subscribe('a', () => undefined);
      backend.subscribe = async () => {
        startSubscription();
        await new Promise<void>(resolve => {
          resume = resolve;
        });
        return { added: true };
      };

      backend.heartbeatResult = false;
      const recovering = (relay as any).heartbeat();
      await subscriptionStarted;
      backend.heartbeatResult = true;
      await vi.advanceTimersByTimeAsync(35);

      expect(
        backend.calls.filter(call => call === 'heartbeat').length,
      ).toBeGreaterThan(1);
      resume();
      await recovering;
    } finally {
      resume?.();
      await relay.close();
      vi.useRealTimers();
    }
  });

  it('retries a recovery that failed part way', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend);
    await relay.waitUntilReady();
    await relay.subscribe('a', () => undefined);
    await relay.subscribe('b', () => undefined);
    let recovered = 0;
    relay.on('recovered', () => recovered++);

    // Swept, and restoring the subscriptions fails.
    backend.heartbeatResult = false;
    backend.fail.subscribe = new Error('network blip');
    await expect((relay as any).heartbeat()).rejects.toThrow('network blip');
    expect(recovered).toBe(0);

    // The node is registered again, but the recovery is still pending.
    backend.heartbeatResult = true;
    delete backend.fail.subscribe;
    const before = backend.calls.length;
    await (relay as any).heartbeat();
    expect(recovered).toBe(1);
    const retried = backend.calls.slice(before);
    expect(retried.filter(c => c === 'registerNode')).toHaveLength(1);
    expect(retried.filter(c => c === 'subscribe')).toHaveLength(2);

    // Once complete, heartbeats don't recover again.
    await (relay as any).heartbeat();
    expect(recovered).toBe(1);
    await relay.close();
  });

  it('removes an endpoint unsubscribed while recovery restores it', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend);
    let resume!: () => void;
    try {
      await relay.waitUntilReady();
      const subscription = await relay.subscribe('a', () => undefined);
      const endpoint = [...(relay as any).endpoints.keys()][0];
      const removeEndpoint = vi.spyOn(backend, 'removeEndpoint');
      backend.heartbeatResult = false;
      backend.subscribe = async () => {
        await new Promise<void>(resolve => {
          resume = resolve;
        });
        return { added: true };
      };

      const recovering = (relay as any).heartbeat();
      await waitFor(() => !!resume);
      await subscription.unsubscribe();
      expect(removeEndpoint).toHaveBeenCalledExactlyOnceWith(
        relay.nodeId,
        endpoint,
      );
      resume();
      await recovering;
      expect(removeEndpoint).toHaveBeenCalledTimes(2);
      expect(removeEndpoint).toHaveBeenLastCalledWith(relay.nodeId, endpoint);
      expect((relay as any).endpoints.size).toBe(0);
    } finally {
      resume?.();
      await relay.close();
    }
  });

  it('keeps failed removals inactive and retries them during recovery', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend);
    const listener = vi.fn();
    try {
      await relay.waitUntilReady();
      const subscription = await relay.subscribe('a', listener);
      const endpoint = [...(relay as any).endpoints.keys()][0];
      const removeEndpoint = vi
        .spyOn(backend, 'removeEndpoint')
        .mockRejectedValueOnce(new Error('temporary removal failure'))
        .mockResolvedValue(1);

      await expect(subscription.unsubscribe()).rejects.toThrow(
        'temporary removal failure',
      );
      expect((relay as any).endpoints.get(endpoint).active).toBe(false);

      backend.inbox.push({
        entries: [
          {
            kind: 'msg',
            topic: 'a',
            mid: '1',
            ts: 1,
            data: '1',
            endpoints: [endpoint],
          },
        ],
        cursor: '1',
      });
      await waitFor(() => backend.inbox.length === 0);
      expect(listener).not.toHaveBeenCalled();

      backend.heartbeatResult = false;
      await (relay as any).heartbeat();
      expect(removeEndpoint).toHaveBeenCalledTimes(2);
      expect(backend.calls.filter(call => call === 'subscribe')).toHaveLength(
        1,
      );
      expect((relay as any).endpoints.has(endpoint)).toBe(false);
    } finally {
      await relay.close();
    }
  });

  it.each(['initial failure first', 'recovery first'])(
    'cleans up an initial subscription failure overlapping recovery (%s)',
    async order => {
      const backend = new FakeBackend();
      const relay = createRelay(backend);
      let rejectInitial!: (err: Error) => void;
      let resolveRecovery!: () => void;
      let subscriptions = 0;
      const removeEndpoint = vi
        .spyOn(backend, 'removeEndpoint')
        .mockRejectedValueOnce(new Error('temporary removal failure'))
        .mockResolvedValue(1);
      backend.subscribe = vi.fn(() => {
        subscriptions++;
        return new Promise<RelaySubscribeResult>((resolve, reject) => {
          if (subscriptions === 1) {
            rejectInitial = reject;
          } else {
            resolveRecovery = () => resolve({ added: true });
          }
        });
      });

      try {
        await relay.waitUntilReady();
        const subscribing = relay.subscribe('a', () => undefined);
        await waitFor(() => !!rejectInitial);

        backend.heartbeatResult = false;
        const recovering = (relay as any).heartbeat();
        await waitFor(() => !!resolveRecovery);

        if (order === 'initial failure first') {
          rejectInitial(new Error('initial subscription failed'));
          await expect(subscribing).rejects.toThrow(
            'initial subscription failed',
          );
          resolveRecovery();
          await recovering;
        } else {
          resolveRecovery();
          await recovering;
          rejectInitial(new Error('initial subscription failed'));
          await expect(subscribing).rejects.toThrow(
            'initial subscription failed',
          );
          await (relay as any).heartbeat();
        }

        expect(removeEndpoint).toHaveBeenCalledTimes(2);
        expect((relay as any).endpoints.size).toBe(0);
      } finally {
        await relay.close();
      }
    },
  );

  it('waits for recovery before dispatching an inbox batch', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend);
    const events: string[] = [];
    let resume!: () => void;
    try {
      await relay.waitUntilReady();
      await relay.subscribe('a', () => {
        events.push('message');
      });
      relay.on('recovered', () => events.push('recovered'));
      const endpoint = [...(relay as any).endpoints.keys()][0];
      backend.heartbeatResult = false;
      backend.subscribe = async () => {
        await new Promise<void>(resolve => {
          resume = resolve;
        });
        return { added: true };
      };
      const recovering = (relay as any).heartbeat();
      await waitFor(() => !!resume);
      const reads = backend.calls.filter(c => c === 'readInbox').length;
      backend.inbox.push({
        entries: [
          {
            kind: 'msg',
            topic: 'a',
            mid: '1',
            ts: 1,
            data: '1',
            endpoints: [endpoint],
          },
        ],
        cursor: '1',
      });
      await waitFor(
        () => backend.calls.filter(c => c === 'readInbox').length > reads,
      );
      expect(events).toEqual([]);
      backend.heartbeatResult = true;
      resume();
      await recovering;
      await waitFor(() => events.length === 2);
      expect(events).toEqual(['recovered', 'message']);
    } finally {
      resume?.();
      await relay.close();
    }
  });

  it('discards a fetched inbox batch when recovery replaces its registration', async () => {
    const backend = new FakeBackend();
    let releaseRead!: () => void;
    let readStarted!: () => void;
    const pendingRead = new Promise<void>(resolve => {
      releaseRead = resolve;
    });
    const started = new Promise<void>(resolve => {
      readStarted = resolve;
    });
    const readEmptyInbox = backend.readInbox.bind(backend);
    let firstRead = true;
    let endpoint = '';
    backend.readInbox = async () => {
      backend.calls.push('readInbox');
      if (firstRead) {
        firstRead = false;
        readStarted();
        await pendingRead;
        return {
          entries: [
            {
              kind: 'msg',
              topic: 'a',
              mid: '1',
              ts: 1,
              data: '1',
              endpoints: [endpoint],
            },
          ],
          cursor: '1',
        };
      }
      return readEmptyInbox();
    };
    const relay = createRelay(backend);
    const events: string[] = [];
    let resumeRecovery!: () => void;
    try {
      await relay.waitUntilReady();
      await relay.subscribe('a', () => events.push('message'));
      await started;
      endpoint = [...(relay as any).endpoints.keys()][0];
      relay.on('recovered', () => events.push('recovered'));
      backend.heartbeatResult = false;
      backend.subscribe = async () => {
        await new Promise<void>(resolve => {
          resumeRecovery = resolve;
        });
        return { added: true };
      };
      const recovering = (relay as any).heartbeat();
      await waitFor(() => !!resumeRecovery);
      releaseRead();
      backend.heartbeatResult = true;
      resumeRecovery();
      await recovering;
      await waitFor(() => events.includes('recovered'));
      await waitFor(
        () => backend.calls.filter(c => c === 'readInbox').length >= 2,
      );

      expect(events).toEqual(['recovered']);
      expect((relay as any).cursor).toBe('0');
    } finally {
      releaseRead();
      resumeRecovery?.();
      await relay.close();
    }
  });

  it('does not overlap sweeps', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend);
    await relay.waitUntilReady();
    await Promise.all([(relay as any).sweep(), (relay as any).sweep()]);
    expect(backend.calls.filter(c => c === 'sweep')).toHaveLength(1);
    await relay.close();
  });

  it.each([false, true])(
    'waits for an active sweep before closing (fails: %s)',
    async fails => {
      vi.useFakeTimers();
      const backend = new FakeBackend();
      let resume!: () => void;
      const sweep = vi.spyOn(backend, 'sweep').mockImplementation(async () => {
        await new Promise<void>(resolve => {
          resume = resolve;
        });
        if (fails) {
          throw new Error('sweep failed');
        }
        return ['expired'];
      });
      const relay = createRelay(backend, { sweepInterval: 10 });
      const swept = vi.fn();
      const error = vi.fn();
      relay.on('swept', swept);
      relay.on('error', error);
      try {
        await relay.waitUntilReady();
        await vi.advanceTimersByTimeAsync(30);
        expect(sweep).toHaveBeenCalledTimes(1);
        const closed = vi.fn();
        const closing = relay.close().then(closed);
        await vi.advanceTimersByTimeAsync(30);
        expect(closed).not.toHaveBeenCalled();
        expect(backend.calls).not.toContain('unregisterNode');
        expect(backend.calls).not.toContain('close');
        resume();
        await closing;
        expect(backend.calls.slice(-2)).toEqual(['unregisterNode', 'close']);
        expect(swept).toHaveBeenCalledTimes(fails ? 0 : 1);
        expect(error).toHaveBeenCalledTimes(fails ? 1 : 0);
        swept.mockClear();
        error.mockClear();
        await vi.advanceTimersByTimeAsync(30);
        expect(sweep).toHaveBeenCalledTimes(1);
        expect(swept).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
      } finally {
        resume?.();
        await relay.close();
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    },
  );

  it('trims its inbox on heartbeat and emits lag past the threshold', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend, {
      inboxMaxLength: 100,
      lagThreshold: 5,
    });
    await relay.waitUntilReady();
    const lags: number[] = [];
    relay.on('lag', backlog => lags.push(backlog));

    backend.backlog = 3;
    (relay as any).batchInFlight = false;
    await (relay as any).checkBacklog();
    expect(lags).toEqual([]);
    expect(backend.trimmed.at(-1)).toEqual([relay.nodeId, '0', 100]);

    backend.backlog = 7;
    (relay as any).batchInFlight = false;
    await (relay as any).checkBacklog();
    expect(lags).toEqual([7]);
    await relay.close();
  });

  it('trims during pending inbox reads but protects fetched batches', async () => {
    let releaseRead!: (batch: RelayInboxBatch) => void;
    let readStarted!: () => void;
    const pendingRead = new Promise<RelayInboxBatch>(resolve => {
      releaseRead = resolve;
    });
    const started = new Promise<void>(resolve => {
      readStarted = resolve;
    });
    const backend = new FakeBackend();
    const readInbox = backend.readInbox.bind(backend);
    let firstRead = true;
    vi.spyOn(backend, 'readInbox').mockImplementation(async (...args) => {
      if (firstRead) {
        firstRead = false;
        readStarted();
        return pendingRead;
      }
      return readInbox(...args);
    });
    const relay = createRelay(backend);
    try {
      await relay.waitUntilReady();
      await started;
      await (relay as any).heartbeat(true);
      expect(backend.trimmed).toEqual([[relay.nodeId, '0', 10_000]]);

      (relay as any).batchInFlight = true;
      await (relay as any).heartbeat(true);
      expect(backend.trimmed).toHaveLength(1);

      releaseRead({ entries: [], cursor: '0' });
    } finally {
      releaseRead({ entries: [], cursor: '0' });
      await relay.close();
    }
  });

  it('defaults lagThreshold to half of inboxMaxLength', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend, { inboxMaxLength: 10 });
    await relay.waitUntilReady();
    const lags: number[] = [];
    relay.on('lag', backlog => lags.push(backlog));
    backend.backlog = 4;
    (relay as any).batchInFlight = false;
    await (relay as any).checkBacklog();
    backend.backlog = 5;
    (relay as any).batchInFlight = false;
    await (relay as any).checkBacklog();
    expect(lags).toEqual([5]);
    await relay.close();
  });

  it('rejects an invalid lagThreshold', () => {
    for (const lagThreshold of [0, -1, 1.5]) {
      expect(() => createRelay(new FakeBackend(), { lagThreshold })).toThrow(
        'Invalid relay lagThreshold',
      );
    }
  });
});
