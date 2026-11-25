/**
 * Hermetic lifecycle tests for the Bun adapter connection state machine.
 *
 * One connection attempt at a time, cancelled by quit()/disconnect(), and a
 * synchronous 'close' listener on disconnect(true) must see 'reconnecting'.
 * Controllable mock raw client — no Redis.
 *
 * Run with: yarn vitest run --no-file-parallelism tests/bun-redis-lifecycle.test.ts
 */
import { describe, expect, it, vi } from 'vitest';
import { createBunRedisClient } from '../src/classes/bun-redis-client';
import { ConnectionClosedError } from '../src/classes/errors/connection-closed-error';

class ControlledRaw {
  connected = false;
  duplicatesConnected = false;
  onconnect: ((...args: any[]) => void) | null = null;
  onclose: ((...args: any[]) => void) | null = null;
  onerror: ((...args: any[]) => void) | null = null;
  closeCalls = 0;
  duplicateCalls = 0;
  sent: string[] = [];

  private connectsWithoutCallback = false;
  private rejectNextDuplicate = false;
  private connectResolve!: () => void;
  private connectReject!: (err: Error) => void;
  private readonly connectPromise: Promise<void>;
  private pendingDuplicates: Array<() => void> = [];
  private sendResolve?: (value: string) => void;
  private sendReject?: (err: Error) => void;

  constructor(private created: ControlledRaw[]) {
    this.created.push(this);
    this.connectPromise = new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
    });
  }

  connect(): Promise<void> {
    if (this.connectsWithoutCallback) {
      return Promise.resolve();
    }
    return this.connectPromise;
  }

  resolveConnect(): void {
    this.connected = true;
    this.onconnect?.();
    this.connectResolve();
  }

  failConnect(): void {
    this.onclose?.(new Error('Connection closed'));
    this.connectReject(
      Object.assign(new Error('Connection closed'), {
        code: 'ERR_REDIS_CONNECTION_CLOSED',
      }),
    );
  }

  /** The next `duplicate()` rejects once, as a dropped connection during setup. */
  rejectDuplicateOnce(): void {
    this.rejectNextDuplicate = true;
  }

  duplicate(): Promise<ControlledRaw> {
    this.duplicateCalls++;
    if (this.rejectNextDuplicate) {
      this.rejectNextDuplicate = false;
      return Promise.reject(new Error('Connection closed'));
    }
    const next = this.duplicatesConnected
      ? undefined
      : new ControlledRaw(this.created);
    return new Promise(resolve => {
      this.pendingDuplicates.push(() => {
        const raw = next ?? new ControlledRaw(this.created);
        if (this.duplicatesConnected) {
          raw.connected = true;
          raw.connectsWithoutCallback = true;
        }
        resolve(raw);
      });
    });
  }

  /** Resolves one pending duplicate, oldest first unless `index` is given. */
  resolveDuplicate(index = 0): void {
    this.pendingDuplicates.splice(index, 1)[0]?.();
  }

  close(): void {
    this.connected = false;
    this.closeCalls++;
  }

  drop(): void {
    this.connected = false;
    this.onclose?.(new Error('Connection closed'));
  }

  send(cmd: string): Promise<string> {
    this.sent.push(cmd);
    if (cmd === 'CLIENT') {
      return new Promise((resolve, reject) => {
        this.sendResolve = resolve;
        this.sendReject = reject;
      });
    }
    return Promise.resolve('OK');
  }

  resolveSend(): void {
    this.sendResolve?.('OK');
  }

  rejectSend(err: Error): void {
    this.sendReject?.(err);
  }

  async get(): Promise<null> {
    return null;
  }

  async smembers(): Promise<never[]> {
    return [];
  }

  async incr(): Promise<number> {
    return 0;
  }
}

function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve)).then(
    () => new Promise(resolve => setImmediate(resolve)),
  );
}

async function connectedAdapter(created: ControlledRaw[]) {
  const raw = new ControlledRaw(created);
  const adapter = createBunRedisClient(raw as any);
  adapter.on('error', () => {});
  const connecting = adapter.connect();
  raw.resolveConnect();
  await connecting;
  return { raw, adapter };
}

describe('bun adapter connection lifecycle', () => {
  it('quit() cancels a duplicate that is still materializing', async () => {
    const created: ControlledRaw[] = [];
    const raw = new ControlledRaw(created);
    const primary = createBunRedisClient(raw as any);
    const adapters = [primary];
    try {
      const connecting = primary.connect();
      raw.resolveConnect();
      await connecting;

      const child = primary.duplicate();
      adapters.push(child);
      await flush();
      await child.quit();
      raw.resolveDuplicate();
      await flush();

      const duplicated = created[1];
      expect(child.status).toBe('end');
      expect(duplicated.connected).toBe(false);
      expect(duplicated.closeCalls).toBeGreaterThanOrEqual(1);
    } finally {
      await Promise.all(adapters.map(adapter => adapter.quit()));
    }
  });

  it('connect() after a drop reports connecting while it duplicates the raw', async () => {
    const created: ControlledRaw[] = [];
    const { raw, adapter } = await connectedAdapter(created);
    try {
      raw.drop();
      const pending = adapter.connect();
      await flush();
      expect(adapter.status).toBe('connecting');
      raw.resolveDuplicate();
      await flush();
      created[1].resolveConnect();
      await pending;
      expect(adapter.status).toBe('ready');
    } finally {
      await adapter.quit();
    }
  });

  it('concurrent connect() calls after a drop share one attempt', async () => {
    const created: ControlledRaw[] = [];
    const { raw, adapter } = await connectedAdapter(created);
    try {
      raw.drop();
      const pending = [adapter.connect(), adapter.connect(), adapter.connect()];
      await flush();
      expect(raw.duplicateCalls).toBe(1);
      raw.resolveDuplicate();
      await flush();
      created[1].resolveConnect();
      await Promise.all(pending);
      await adapter.quit();
      await flush();
      expect(created.every(client => !client.connected)).toBe(true);
    } finally {
      await adapter.quit();
    }
  });

  it('disconnect(true) reports reconnecting to a synchronous close listener', async () => {
    const created: ControlledRaw[] = [];
    const { adapter } = await connectedAdapter(created);
    try {
      let seen: string | undefined;
      adapter.once('close', () => {
        seen = adapter.status;
      });
      adapter.disconnect(true);
      expect(seen).toBe('reconnecting');
    } finally {
      await adapter.quit();
    }
  });

  it('a drop during CLIENT SETNAME does not emit ready', async () => {
    const created: ControlledRaw[] = [];
    const { raw, adapter: primary } = await connectedAdapter(created);
    const child = primary.duplicate({ connectionName: 'lifecycle' });
    child.on('error', () => {});
    let ready = 0;
    child.on('ready', () => {
      ready++;
    });
    const pending = child.connect();
    pending.catch(() => {});
    try {
      await flush();
      raw.resolveDuplicate();
      await flush();
      const childRaw = created[1];
      childRaw.resolveConnect();
      childRaw.drop();
      childRaw.rejectSend(new Error('Connection closed'));
      await flush();
      expect(ready).toBe(0);
      expect(child.status).not.toBe('ready');
      pending.catch(() => {});
    } finally {
      await pending.catch(() => {});
      await child.quit();
      await primary.quit();
    }
  });

  it('disconnect(true) does not report ready while the replacement connects', async () => {
    const created: ControlledRaw[] = [];
    const { raw, adapter } = await connectedAdapter(created);
    const old = raw;
    try {
      adapter.disconnect(true);
      const p = adapter.connect();
      await flush();
      expect(adapter.status).toBe('connecting');
      await expect(adapter.sendCommand('PING', [])).rejects.toBeInstanceOf(
        ConnectionClosedError,
      );
      expect(old.sent).not.toContain('PING');
      old.resolveDuplicate();
      await flush();
      created[1].resolveConnect();
      await p;
      expect(adapter.status).toBe('ready');
    } finally {
      await adapter.quit();
    }
  });

  it('a replacement that is already connected becomes ready', async () => {
    const created: ControlledRaw[] = [];
    const { raw, adapter } = await connectedAdapter(created);
    try {
      raw.duplicatesConnected = true;
      adapter.disconnect(true);
      let readyAfterDisconnect = false;
      adapter.on('ready', () => {
        readyAfterDisconnect = true;
      });
      const p = adapter.connect();
      await flush();
      raw.resolveDuplicate();
      await p;
      expect(adapter.status).toBe('ready');
      expect(readyAfterDisconnect).toBe(true);
    } finally {
      await adapter.quit();
    }
  });

  it('a drop right after connect leaves recovery to the close handler', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const created: ControlledRaw[] = [];
    const { raw, adapter } = await connectedAdapter(created);
    try {
      raw.drop();
      const p = adapter.connect().catch(() => {});
      await flush();
      raw.resolveDuplicate();
      await flush();
      const next = created[1];
      next.resolveConnect();
      next.drop();
      await flush();
      await flush();
      await p;
      expect(adapter.status).toBe('reconnecting');
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      await adapter.quit();
      vi.useRealTimers();
    }
  });

  it('a superseded reconnect attempt does not reschedule', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const created: ControlledRaw[] = [];
    const { raw, adapter } = await connectedAdapter(created);
    try {
      adapter.disconnect(true);
      vi.advanceTimersByTime(1000);
      await flush();
      adapter.disconnect(true);
      vi.advanceTimersByTime(1000);
      await flush();
      raw.resolveDuplicate(1);
      await flush();
      created[2].resolveConnect();
      await flush();
      raw.resolveDuplicate();
      await flush();
      await flush();
      expect(adapter.status).toBe('ready');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await adapter.quit();
      vi.useRealTimers();
    }
  });

  it('a lazy duplicate whose first materialization fails retries', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const created: ControlledRaw[] = [];
    const { raw, adapter: primary } = await connectedAdapter(created);
    raw.rejectDuplicateOnce();
    const child = primary.duplicate();
    child.on('error', () => {});
    const ready = new Promise<void>(resolve => {
      child.once('ready', () => resolve());
    });
    try {
      await flush();
      expect(child.status).toBe('reconnecting');
      expect(raw.duplicateCalls).toBe(1);

      vi.advanceTimersByTime(1000);
      await flush();
      expect(raw.duplicateCalls).toBe(2);
      raw.resolveDuplicate();
      await flush();
      created[1].resolveConnect();
      await ready;
      expect(child.status).toBe('ready');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      await child.quit();
      await primary.quit();
      vi.useRealTimers();
    }
  });

  it('quit() during a lazy duplicate reconnect backoff stands down', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const created: ControlledRaw[] = [];
    const { raw, adapter: primary } = await connectedAdapter(created);
    raw.rejectDuplicateOnce();
    const child = primary.duplicate();
    child.on('error', () => {});
    try {
      await flush();
      expect(child.status).toBe('reconnecting');
      const calls = raw.duplicateCalls;
      await child.quit();
      vi.advanceTimersByTime(20000);
      await flush();
      expect(child.status).toBe('end');
      expect(raw.duplicateCalls).toBe(calls);
    } finally {
      await child.quit();
      await primary.quit();
      vi.useRealTimers();
    }
  });

  it('an explicit reconnect whose replacement duplicate fails retries', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const created: ControlledRaw[] = [];
    const { raw, adapter } = await connectedAdapter(created);
    let reopening: Promise<void> = Promise.resolve();
    try {
      adapter.disconnect();
      raw.rejectDuplicateOnce();
      reopening = adapter.connect();
      void reopening.catch(() => {});
      await flush();
      expect(adapter.status).toBe('reconnecting');
      expect(raw.duplicateCalls).toBe(1);

      vi.advanceTimersByTime(1000);
      await flush();
      expect(raw.duplicateCalls).toBe(2);
      raw.resolveDuplicate();
      await flush();
      created[1].resolveConnect();
      await flush();
      expect(adapter.status).toBe('ready');
    } finally {
      await adapter.quit();
      await flush();
      raw.resolveDuplicate();
      created[1]?.resolveConnect();
      await reopening.catch(() => {});
      vi.useRealTimers();
    }
  });

  it('a duplicate of a disconnected unmaterialized duplicate does not retry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const created: ControlledRaw[] = [];
    const { raw, adapter: primary } = await connectedAdapter(created);
    const parent = primary.duplicate();
    parent.on('error', () => {});
    parent.disconnect();
    let factoryCalls = 0;
    const ensureRaw = parent._ensureRaw.bind(parent);
    parent._ensureRaw = () => {
      factoryCalls++;
      return ensureRaw();
    };
    const child = parent.duplicate();
    child.on('error', () => {});
    try {
      await expect(child.connect()).rejects.toBeInstanceOf(
        ConnectionClosedError,
      );
      const calls = raw.duplicateCalls;
      const factories = factoryCalls;
      vi.advanceTimersByTime(60_000);
      await flush();
      expect(vi.getTimerCount()).toBe(0);
      expect(raw.duplicateCalls).toBe(calls);
      expect(factoryCalls).toBe(factories);
      expect(child.status).not.toBe('reconnecting');
    } finally {
      await child.quit();
      await parent.quit();
      await primary.quit();
      vi.useRealTimers();
    }
  });

  it('a synchronous ready listener cannot start a second attempt', async () => {
    const created: ControlledRaw[] = [];
    const raw = new ControlledRaw(created);
    raw.connected = true;
    const adapter = createBunRedisClient(raw as any, { lazyConnect: true });
    adapter.on('error', () => {});
    try {
      adapter.once('ready', () => {
        adapter.disconnect(true);
        void adapter.connect().catch(() => {});
        void adapter.connect().catch(() => {});
      });
      await adapter.connect().catch(() => {});
      await flush();
      expect(raw.duplicateCalls).toBeLessThanOrEqual(1);
      expect(
        created.filter(client => client.connected).length,
      ).toBeLessThanOrEqual(1);
    } finally {
      await adapter.quit();
    }
  });
});
