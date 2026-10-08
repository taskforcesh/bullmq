import { describe, expect, it } from 'vitest';
import {
  IRelayBackend,
  Relay,
  RelayInboxBatch,
  RelayPublishResult,
  RelaySubscribeResult,
} from '../src';
import { waitFor } from './utils/relay-suite';

/**
 * Scriptable in-memory backend used to exercise the Relay's error handling,
 * which is hard to trigger against a real datastore.
 */
class FakeBackend implements IRelayBackend {
  readonly namespace = 'fake';
  readonly initialInboxCursor = '0';
  fail: Partial<Record<keyof IRelayBackend, Error>> = {};
  heartbeatResult = true;
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
  async registerNode() {
    this.check('registerNode');
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
  it('requires a connection', () => {
    expect(() => new Relay(undefined as any)).toThrow(
      'Relay requires a connection',
    );
    expect(() => new Relay({} as any)).toThrow('Relay requires a connection');
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

  it('does not overlap sweeps', async () => {
    const backend = new FakeBackend();
    const relay = createRelay(backend);
    await relay.waitUntilReady();
    await Promise.all([(relay as any).sweep(), (relay as any).sweep()]);
    expect(backend.calls.filter(c => c === 'sweep')).toHaveLength(1);
    await relay.close();
  });
});
