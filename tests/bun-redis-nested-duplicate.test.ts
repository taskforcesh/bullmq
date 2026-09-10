/**
 * Hermetic regression for nested Bun adapter duplicate() (#4706).
 *
 * A lazily-created duplicate has no raw client until first connect. Nested
 * `client.duplicate().duplicate()` must still materialize the grandchild
 * instead of closing over undefined `parentRaw`. Mock raw client — no Redis.
 *
 * Run with: yarn vitest run --no-file-parallelism tests/bun-redis-nested-duplicate.test.ts
 */
import { describe, expect, it } from 'vitest';
import { createBunRedisClient } from '../src/classes/bun-redis-client';

class FakeRaw {
  connected = false;
  onconnect: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public target = 'redis://localhost:6379') {}
  async connect() {
    this.connected = true;
    this.onconnect?.();
  }
  close() {
    this.connected = false;
  }
  async duplicate() {
    return new FakeRaw(this.target);
  }
  async send() {
    return 'PONG';
  }
  async get() {
    return null;
  }
  async smembers() {
    return [];
  }
  async incr() {
    return 0;
  }
}

describe('bun adapter nested duplicate (#4706)', () => {
  it('single duplicate() still materializes a raw client', async () => {
    const primary = createBunRedisClient(new FakeRaw() as any);
    await primary.connect();

    const child = primary.duplicate();
    await child.connect();

    expect(child.status).toBe('ready');
    expect((child as any).raw).toBeDefined();
    expect((child as any).raw.target).toBe('redis://localhost:6379');

    await primary.quit();
    await child.quit();
  });

  it('nested duplicate().duplicate() materializes the grandchild without TypeError', async () => {
    const primary = createBunRedisClient(new FakeRaw() as any);
    await primary.connect();

    const grandchild = primary.duplicate().duplicate();
    await grandchild.connect();

    expect(grandchild.status).toBe('ready');
    expect((grandchild as any).raw).toBeDefined();
    expect((grandchild as any).raw.target).toBe('redis://localhost:6379');

    await primary.quit();
    await grandchild.quit();
  });

  it('nested duplicate can send a command before an explicit connect()', async () => {
    const primary = createBunRedisClient(new FakeRaw() as any);
    await primary.connect();

    const grandchild = primary.duplicate().duplicate();
    const reply = await grandchild.sendCommand('PING', []);

    expect(reply).toBe('PONG');
    expect(grandchild.status).toBe('ready');

    await primary.quit();
    await grandchild.quit();
  });
});
