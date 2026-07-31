import { default as IORedis } from 'ioredis';
import { describe, it, expect } from 'vitest';

import * as sinon from 'sinon';
import { createIORedisClient } from '../src/classes/ioredis-client';

describe('createIORedisClient duplicate routing', () => {
  it('should route duplicate({ connectionName }) through redisOptions for Cluster', () => {
    const fakeClusterDuplicate = sinon.stub().returns({
      isCluster: true,
      options: {},
      duplicate: sinon.stub(),
      pipeline: sinon.stub().returns({ exec: sinon.stub() }),
      multi: sinon.stub(),
      defineCommand: sinon.stub(),
      hset: sinon.stub(),
      set: sinon.stub(),
      zrange: sinon.stub(),
      zrevrange: sinon.stub(),
      xadd: sinon.stub(),
      xread: sinon.stub(),
      xtrim: sinon.stub(),
      bzpopmin: sinon.stub(),
      scan: sinon.stub(),
      client: sinon.stub(),
      status: 'ready',
      on: sinon.stub(),
      once: sinon.stub(),
      off: sinon.stub(),
      connect: sinon.stub(),
      disconnect: sinon.stub(),
      scanStream: sinon.stub(),
    });

    // Minimal ioredis Cluster-like object
    const fakeCluster = {
      isCluster: true,
      options: { redisOptions: { password: 'secret' } },
      duplicate: fakeClusterDuplicate,
      pipeline: sinon.stub().returns({ exec: sinon.stub() }),
      multi: sinon.stub(),
      defineCommand: sinon.stub(),
      hset: sinon.stub(),
      set: sinon.stub(),
      zrange: sinon.stub(),
      zrevrange: sinon.stub(),
      xadd: sinon.stub(),
      xread: sinon.stub(),
      xtrim: sinon.stub(),
      bzpopmin: sinon.stub(),
      scan: sinon.stub(),
      client: sinon.stub(),
      status: 'ready',
      on: sinon.stub(),
      once: sinon.stub(),
      off: sinon.stub(),
      connect: sinon.stub(),
      disconnect: sinon.stub(),
      scanStream: sinon.stub(),
    } as any;

    const adapted = createIORedisClient(fakeCluster);
    adapted.duplicate({ connectionName: 'bull:abc:w:myWorker' });

    expect(fakeClusterDuplicate.calledOnce).toBe(true);
    const args = fakeClusterDuplicate.getCall(0).args;

    // First arg must be undefined (startup nodes)
    expect(args[0]).toBeUndefined();

    // Second arg must carry redisOptions with merged connectionName + existing options
    expect(args[1]).toHaveProperty('redisOptions');
    expect(args[1].redisOptions.connectionName).toBe('bull:abc:w:myWorker');
    // Existing redisOptions (e.g. password) must be preserved
    expect(args[1].redisOptions.password).toBe('secret');
  });

  it('should pass options directly for non-Cluster Redis', () => {
    const fakeRedisDuplicate = sinon.stub().returns({
      isCluster: false,
      options: {},
      duplicate: sinon.stub(),
      pipeline: sinon.stub().returns({ exec: sinon.stub() }),
      multi: sinon.stub(),
      defineCommand: sinon.stub(),
      hset: sinon.stub(),
      set: sinon.stub(),
      zrange: sinon.stub(),
      zrevrange: sinon.stub(),
      xadd: sinon.stub(),
      xread: sinon.stub(),
      xtrim: sinon.stub(),
      bzpopmin: sinon.stub(),
      scan: sinon.stub(),
      client: sinon.stub(),
      status: 'ready',
      on: sinon.stub(),
      once: sinon.stub(),
      off: sinon.stub(),
      connect: sinon.stub(),
      disconnect: sinon.stub(),
      scanStream: sinon.stub(),
    });

    const fakeRedis = {
      isCluster: false,
      options: {},
      duplicate: fakeRedisDuplicate,
      pipeline: sinon.stub().returns({ exec: sinon.stub() }),
      multi: sinon.stub(),
      defineCommand: sinon.stub(),
      hset: sinon.stub(),
      set: sinon.stub(),
      zrange: sinon.stub(),
      zrevrange: sinon.stub(),
      xadd: sinon.stub(),
      xread: sinon.stub(),
      xtrim: sinon.stub(),
      bzpopmin: sinon.stub(),
      scan: sinon.stub(),
      client: sinon.stub(),
      status: 'ready',
      on: sinon.stub(),
      once: sinon.stub(),
      off: sinon.stub(),
      connect: sinon.stub(),
      disconnect: sinon.stub(),
      scanStream: sinon.stub(),
    } as any;

    const adapted = createIORedisClient(fakeRedis);
    adapted.duplicate({ connectionName: 'bull:abc:w:myWorker' });

    expect(fakeRedisDuplicate.calledOnce).toBe(true);
    const args = fakeRedisDuplicate.getCall(0).args;

    // For non-cluster, options go directly as first arg
    expect(args[0]).toEqual({ connectionName: 'bull:abc:w:myWorker' });
    expect(args[1]).toBeUndefined();
  });
});

describe('createIORedisClient does not mutate the raw client', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';

  it('should not add bullmq markers or override methods on the raw ioredis instance', async () => {
    const raw = new IORedis(redisHost, { maxRetriesPerRequest: null });
    try {
      // Snapshot every method/property the proxy overrides, plus a couple of
      // EventEmitter methods that the proxy forwards via the `get` trap.
      const originalPipeline = raw.pipeline;
      const originalMulti = raw.multi;
      const originalDuplicate = raw.duplicate;
      const originalHset = (raw as any).hset;
      const originalSet = raw.set;
      const originalZrange = raw.zrange;
      const originalZrevrange = raw.zrevrange;
      const originalXadd = raw.xadd;
      const originalXread = raw.xread;
      const originalXtrim = raw.xtrim;
      const originalScan = raw.scan;
      const originalClient = (raw as any).client;
      const originalOn = raw.on;
      const originalOff = (raw as any).off;
      const originalOnce = raw.once;
      const originalKeys = new Set(Object.keys(raw));

      const adapted = createIORedisClient(raw);

      // The proxy itself exposes the bullmq marker, but the raw client must not.
      expect(adapted.__bullmq_iredis).toBe(true);
      expect((raw as any).__bullmq_iredis).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(raw, '__bullmq_iredis')).toBe(
        false,
      );
      expect(Object.prototype.hasOwnProperty.call(raw, 'runCommand')).toBe(
        false,
      );

      // No method on the raw instance has been reassigned.
      expect(raw.pipeline).toBe(originalPipeline);
      expect(raw.multi).toBe(originalMulti);
      expect(raw.duplicate).toBe(originalDuplicate);
      expect((raw as any).hset).toBe(originalHset);
      expect(raw.set).toBe(originalSet);
      expect(raw.zrange).toBe(originalZrange);
      expect(raw.zrevrange).toBe(originalZrevrange);
      expect(raw.xadd).toBe(originalXadd);
      expect(raw.xread).toBe(originalXread);
      expect(raw.xtrim).toBe(originalXtrim);
      expect(raw.scan).toBe(originalScan);
      expect((raw as any).client).toBe(originalClient);
      expect(raw.on).toBe(originalOn);
      expect((raw as any).off).toBe(originalOff);
      expect(raw.once).toBe(originalOnce);

      // No new enumerable own keys were added.
      for (const key of Object.keys(raw)) {
        expect(originalKeys.has(key)).toBe(true);
      }
    } finally {
      await raw.quit();
    }
  });

  it('should return the same proxy when wrapping the same raw client twice', () => {
    const raw = new IORedis(redisHost, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    try {
      const a = createIORedisClient(raw);
      const b = createIORedisClient(raw);
      expect(a).toBe(b);
    } finally {
      raw.disconnect();
    }
  });

  it('should be idempotent when called with an already-wrapped client', () => {
    const raw = new IORedis(redisHost, {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });
    try {
      const wrapped = createIORedisClient(raw);
      const rewrapped = createIORedisClient(wrapped as any);
      expect(rewrapped).toBe(wrapped);
    } finally {
      raw.disconnect();
    }
  });
});
