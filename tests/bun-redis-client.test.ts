import { describe, expect, it } from 'vitest';

import { createBunRedisClient } from '../src/classes/bun-redis-client';

describe('BunRedisAdapter', () => {
  it('discards a duplicate whose factory resolves after final disconnect', async () => {
    let releaseDuplicate!: () => void;
    let markDuplicateStarted!: () => void;
    const duplicateStarted = new Promise<void>(resolve => {
      markDuplicateStarted = resolve;
    });
    const duplicateReleased = new Promise<void>(resolve => {
      releaseDuplicate = resolve;
    });

    class FakeRaw {
      connected = false;
      connectCalls = 0;
      onconnect: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;

      async connect() {
        this.connectCalls++;
        this.connected = true;
        this.onconnect?.();
      }

      close() {
        this.connected = false;
      }

      async duplicate() {
        markDuplicateStarted();
        await duplicateReleased;
        return lateRaw;
      }

      async send() {
        return null;
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

    const lateRaw = new FakeRaw();
    const primary = createBunRedisClient(new FakeRaw() as any);
    await primary.connect();

    const duplicate = primary.duplicate();
    await duplicateStarted;
    duplicate.disconnect();
    releaseDuplicate();
    await new Promise(resolve => setImmediate(resolve));

    expect(duplicate.status).toBe('end');
    expect(lateRaw.connectCalls).toBe(0);
    expect(lateRaw.connected).toBe(false);

    await primary.quit();
  });
});
