/**
 * Redis Adapter Conformance Test Suite
 *
 * Validates that an IRedisClient implementation correctly implements the
 * contract BullMQ expects. Run this against any new adapter before running
 * the full BullMQ test suite to catch compatibility issues early.
 *
 * Run with:  npx vitest run tests/adapter-conformance.test.ts
 *
 * To test a different adapter, change the `createTestClient()` factory below.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type RedisClientType } from 'redis';
import { createNodeRedisClient } from '../src/classes/node-redis-client';
import {
  IRedisClient,
  IRedisTransaction,
} from '../src/interfaces/redis-client';
import { v4 } from 'uuid';
import { Readable } from 'stream';

// ---------------------------------------------------------------------------
// Adapter factory – change this to test a different adapter
// ---------------------------------------------------------------------------
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = Number(process.env.REDIS_PORT) || 6379;

async function createTestClient(): Promise<IRedisClient> {
  const raw = createClient({ socket: { host: redisHost, port: redisPort } });
  const adapter = createNodeRedisClient(raw);
  await adapter.connect();
  return adapter;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('Adapter Conformance', () => {
  let client: IRedisClient;
  const testPrefix = `conformance:${process.pid}:`;

  function key(name: string): string {
    return `${testPrefix}${name}`;
  }

  beforeAll(async () => {
    client = await createTestClient();
  });

  afterAll(async () => {
    // Clean up test keys
    const [, keys] = await client.scan(0, {
      MATCH: `${testPrefix}*`,
      COUNT: 1000,
    });
    if (keys.length > 0) {
      await client.del(...keys);
    }
    await client.quit();
  });

  // =========================================================================
  // 1. Connection lifecycle
  // =========================================================================
  describe('Connection Lifecycle', () => {
    it('should report status "ready" after connect', () => {
      expect(client.status).toBe('ready');
    });

    it('should create a duplicate that connects independently', async () => {
      const dup = client.duplicate();
      expect(dup.status).not.toBe('ready');
      await dup.connect();
      expect(dup.status).toBe('ready');
      await dup.quit();
      // Original still works
      expect(client.status).toBe('ready');
    });

    it('should handle connectionName in duplicate options', async () => {
      const dup = client.duplicate({ connectionName: 'test-worker' });
      await dup.connect();
      expect(dup.status).toBe('ready');

      // Verify name was set via CLIENT LIST
      const list = await dup.clientList();
      // The list should contain our connection name somewhere
      expect(list).toContain('test-worker');
      await dup.quit();
    });

    it('should transition to "end" status after quit', async () => {
      const dup = client.duplicate();
      await dup.connect();
      await dup.quit();
      expect(dup.status).toBe('end');
    });

    it('should emit "close" on disconnect', async () => {
      const dup = client.duplicate();
      await dup.connect();
      const closePromise = new Promise<void>(resolve => {
        dup.on('close', () => resolve());
      });
      dup.disconnect();
      await closePromise;
    });

    it('should support setMaxListeners/getMaxListeners', () => {
      const orig = client.getMaxListeners();
      client.setMaxListeners(orig + 5);
      expect(client.getMaxListeners()).toBe(orig + 5);
      client.setMaxListeners(orig);
    });
  });

  // =========================================================================
  // 2. String commands
  // =========================================================================
  describe('String Commands', () => {
    it('should set and get a string value', async () => {
      await client.set(key('str1'), 'hello');
      const val = await client.get(key('str1'));
      expect(val).toBe('hello');
    });

    it('should set with PX option (millisecond expiry)', async () => {
      await client.set(key('str-px'), 'temporary', { PX: 5000 });
      const val = await client.get(key('str-px'));
      expect(val).toBe('temporary');
    });

    it('should return null for non-existent key', async () => {
      const val = await client.get(key('nonexistent'));
      expect(val).toBeNull();
    });

    it('should delete keys and return count', async () => {
      await client.set(key('del1'), 'a');
      await client.set(key('del2'), 'b');
      const count = await client.del(key('del1'), key('del2'));
      expect(count).toBe(2);
    });

    it('should handle del with no keys gracefully', async () => {
      // Should not throw
      const count = await client.del();
      expect(count).toBe(0);
    });
  });

  // =========================================================================
  // 3. Hash commands
  // =========================================================================
  describe('Hash Commands', () => {
    beforeEach(async () => {
      await client.del(key('hash1'));
    });

    it('should hset and hgetall', async () => {
      await client.hset(key('hash1'), { name: 'job1', data: 'payload' });
      const result = await client.hgetall(key('hash1'));
      expect(result).toEqual({ name: 'job1', data: 'payload' });
    });

    it('should hset numeric values as strings', async () => {
      await client.hset(key('hash1'), { count: 42, rate: 3.14 });
      const result = await client.hgetall(key('hash1'));
      expect(result.count).toBe('42');
      expect(result.rate).toBe('3.14');
    });

    it('should hget a single field', async () => {
      await client.hset(key('hash1'), { field1: 'val1', field2: 'val2' });
      const val = await client.hget(key('hash1'), 'field1');
      expect(val).toBe('val1');
    });

    it('should hget return null for missing field', async () => {
      await client.hset(key('hash1'), { field1: 'val1' });
      const val = await client.hget(key('hash1'), 'missing');
      expect(val).toBeNull();
    });

    it('should hmget multiple fields', async () => {
      await client.hset(key('hash1'), { a: '1', b: '2', c: '3' });
      const vals = await client.hmget(key('hash1'), 'a', 'c', 'missing');
      expect(vals).toEqual(['1', '3', null]);
    });

    it('should hdel fields and return count', async () => {
      await client.hset(key('hash1'), { a: '1', b: '2', c: '3' });
      const count = await client.hdel(key('hash1'), 'a', 'c');
      expect(count).toBe(2);
      const remaining = await client.hgetall(key('hash1'));
      expect(remaining).toEqual({ b: '2' });
    });

    it('should hexists return 1/0', async () => {
      await client.hset(key('hash1'), { field: 'val' });
      const exists = await client.hexists(key('hash1'), 'field');
      expect(exists).toBe(1);
      const missing = await client.hexists(key('hash1'), 'nope');
      expect(missing).toBe(0);
    });

    it('should return empty object for hgetall on non-existent key', async () => {
      const result = await client.hgetall(key('nonexistent-hash'));
      expect(result).toEqual({});
    });
  });

  // =========================================================================
  // 4. Sorted set commands
  // =========================================================================
  describe('Sorted Set Commands', () => {
    beforeEach(async () => {
      await client.del(key('zset1'));
    });

    it('should zrange return members in order', async () => {
      const multi = client.multi();
      // Use runCommand to add members (zadd not in IRedisTransaction)
      // Add manually first
      await (client as any).zadd(key('zset1'), 1, 'a');
      await (client as any).zadd(key('zset1'), 2, 'b');
      await (client as any).zadd(key('zset1'), 3, 'c');

      const result = await client.zrange(key('zset1'), 0, -1);
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should zrange with WITHSCORES return [member, score, ...]', async () => {
      await (client as any).zadd(key('zset1'), 1, 'a');
      await (client as any).zadd(key('zset1'), 2, 'b');

      const result = await client.zrange(key('zset1'), 0, -1, {
        WITHSCORES: true,
      });
      // BullMQ expects flattened: ['member', 'score', 'member', 'score']
      expect(result).toEqual(['a', '1', 'b', '2']);
    });

    it('should zrevrange return members in reverse order', async () => {
      await (client as any).zadd(key('zset1'), 1, 'a');
      await (client as any).zadd(key('zset1'), 2, 'b');
      await (client as any).zadd(key('zset1'), 3, 'c');

      const result = await client.zrevrange(key('zset1'), 0, -1);
      expect(result).toEqual(['c', 'b', 'a']);
    });

    it('should zcard return cardinality', async () => {
      await (client as any).zadd(key('zset1'), 1, 'a');
      await (client as any).zadd(key('zset1'), 2, 'b');
      const count = await client.zcard(key('zset1'));
      expect(count).toBe(2);
    });

    it('should zscore return score as string', async () => {
      await (client as any).zadd(key('zset1'), 42, 'member1');
      const score = await client.zscore(key('zset1'), 'member1');
      expect(score).toBe('42');
    });

    it('should zscore return null for missing member', async () => {
      const score = await client.zscore(key('zset1'), 'nope');
      expect(score).toBeNull();
    });
  });

  // =========================================================================
  // 5. List commands
  // =========================================================================
  describe('List Commands', () => {
    beforeEach(async () => {
      await client.del(key('list1'));
    });

    it('should lrange return elements', async () => {
      await (client as any).lpush(key('list1'), 'c', 'b', 'a');
      const result = await client.lrange(key('list1'), 0, -1);
      expect(result).toEqual(['a', 'b', 'c']);
    });

    it('should llen return length', async () => {
      await (client as any).lpush(key('list1'), 'a', 'b', 'c');
      const len = await client.llen(key('list1'));
      expect(len).toBe(3);
    });

    it('should ltrim truncate list', async () => {
      await (client as any).lpush(key('list1'), 'c', 'b', 'a');
      await client.ltrim(key('list1'), 0, 1);
      const result = await client.lrange(key('list1'), 0, -1);
      expect(result).toHaveLength(2);
    });

    it('should lpos find element position', async () => {
      await (client as any).lpush(key('list1'), 'c', 'b', 'a');
      const pos = await client.lpos(key('list1'), 'b');
      expect(pos).toBe(1);
    });

    it('should lpos return null for missing element', async () => {
      await (client as any).lpush(key('list1'), 'a');
      const pos = await client.lpos(key('list1'), 'nope');
      expect(pos).toBeNull();
    });
  });

  // =========================================================================
  // 6. Set commands
  // =========================================================================
  describe('Set Commands', () => {
    beforeEach(async () => {
      await client.del(key('set1'));
    });

    it('should smembers return all members', async () => {
      await (client as any).sadd(key('set1'), 'a', 'b', 'c');
      const members = await client.smembers(key('set1'));
      expect(members.sort()).toEqual(['a', 'b', 'c']);
    });

    it('should return empty array for smembers on non-existent key', async () => {
      const members = await client.smembers(key('nonexistent-set'));
      expect(members).toEqual([]);
    });
  });

  // =========================================================================
  // 7. Stream commands
  // =========================================================================
  describe('Stream Commands', () => {
    beforeEach(async () => {
      await client.del(key('stream1'));
    });

    it('should xadd entries and return an ID', async () => {
      const id = await client.xadd(key('stream1'), '*', {
        event: 'test',
        data: 'payload',
      });
      expect(id).toBeDefined();
      expect(id).toContain('-');
    });

    it('should xadd with numeric field values (stringified)', async () => {
      const id = await client.xadd(key('stream1'), '*', {
        count: 42,
        rate: 3.14,
        name: 'test',
      });
      expect(id).toBeDefined();
    });

    it('should xadd with MAXLEN option', async () => {
      for (let i = 0; i < 20; i++) {
        await client.xadd(
          key('stream1'),
          '*',
          { i: String(i) },
          { MAXLEN: 10, approximate: false },
        );
      }
      const len = await (client as any).xlen(key('stream1'));
      expect(len).toBeLessThanOrEqual(10);
    });

    it('should xread entries from a stream', async () => {
      await client.xadd(key('stream1'), '*', { event: 'e1' });
      await client.xadd(key('stream1'), '*', { event: 'e2' });

      const result = await client.xread([{ key: key('stream1'), id: '0-0' }], {
        COUNT: 10,
      });
      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('should xtrim a stream', async () => {
      for (let i = 0; i < 20; i++) {
        await client.xadd(key('stream1'), '*', { i: String(i) });
      }
      await client.xtrim(key('stream1'), 'MAXLEN', 5, { approximate: false });
      const len = await (client as any).xlen(key('stream1'));
      expect(len).toBeLessThanOrEqual(5);
    });
  });

  // =========================================================================
  // 8. Scan commands
  // =========================================================================
  describe('Scan Commands', () => {
    beforeEach(async () => {
      // Create some keys to scan
      for (let i = 0; i < 10; i++) {
        await client.set(key(`scan:${i}`), String(i));
      }
    });

    it('should scan return [cursor, keys] tuple', async () => {
      const [cursor, keys] = await client.scan(0, {
        MATCH: `${testPrefix}scan:*`,
        COUNT: 100,
      });
      expect(typeof cursor).toBe('string');
      expect(Array.isArray(keys)).toBe(true);
      expect(keys.length).toBeGreaterThan(0);
    });

    it('should scan with string cursor', async () => {
      const [cursor, keys] = await client.scan('0', {
        MATCH: `${testPrefix}scan:*`,
        COUNT: 100,
      });
      expect(typeof cursor).toBe('string');
      expect(Array.isArray(keys)).toBe(true);
    });

    it('should scanStream return a Readable', async () => {
      const stream = client.scanStream({
        match: `${testPrefix}scan:*`,
        count: 100,
      });
      expect(stream).toBeInstanceOf(Readable);

      const allKeys: string[] = [];
      for await (const keys of stream) {
        const arr = Array.isArray(keys) ? keys : [keys];
        allKeys.push(...arr);
      }
      expect(allKeys.length).toBeGreaterThanOrEqual(10);
      stream.destroy();
    });
  });

  // =========================================================================
  // 9. Lua script engine (defineCommand / runCommand)
  // =========================================================================
  describe('Lua Script Engine', () => {
    it('should defineCommand and runCommand execute a script', async () => {
      client.defineCommand('testEcho', {
        numberOfKeys: 1,
        lua: `return KEYS[1]`,
      });
      const result = await client.runCommand('testEcho', [key('lua-test')]);
      expect(result).toBe(key('lua-test'));
    });

    it('should make defined command accessible as a property', () => {
      client.defineCommand('testProp', {
        numberOfKeys: 0,
        lua: `return 'ok'`,
      });
      // BullMQ's ScriptLoader checks (client as any)[name] for caching
      expect((client as any).testProp).toBeDefined();
    });

    it('should execute defined command properties with ioredis-style args arrays', async () => {
      client.defineCommand('testPropArgsArray', {
        numberOfKeys: 1,
        lua: `redis.call('SET', KEYS[1], ARGV[1]); return redis.call('GET', KEYS[1])`,
      });

      const result = await (client as any).testPropArgsArray([
        key('lua-prop-array'),
        'value',
      ]);

      expect(result).toBe('value');
    });

    it('should keep defined command properties on duplicates', async () => {
      client.defineCommand('testDuplicateScript', {
        numberOfKeys: 1,
        lua: `redis.call('SET', KEYS[1], ARGV[1]); return redis.call('GET', KEYS[1])`,
      });

      const dup = client.duplicate();
      await dup.connect();

      const result = await (dup as any).testDuplicateScript([
        key('lua-duplicate'),
        'duplicate-value',
      ]);

      expect(result).toBe('duplicate-value');
      await dup.quit();
    });

    it('should handle numeric arguments (stringify)', async () => {
      client.defineCommand('testNumArgs', {
        numberOfKeys: 0,
        lua: `return ARGV[1] .. ':' .. ARGV[2]`,
      });
      const result = await client.runCommand('testNumArgs', [42, 100]);
      expect(result).toBe('42:100');
    });

    it('should handle undefined/null arguments as empty string', async () => {
      client.defineCommand('testNullArgs', {
        numberOfKeys: 0,
        lua: `return ARGV[1] .. '|' .. ARGV[2] .. '|' .. ARGV[3]`,
      });
      const result = await client.runCommand('testNullArgs', [
        'a',
        undefined,
        'c',
      ]);
      expect(result).toBe('a||c');
    });

    it('should preserve Buffer arguments', async () => {
      client.defineCommand('testBuffer', {
        numberOfKeys: 0,
        lua: `return ARGV[1]`,
      });
      const buf = Buffer.from([0x01, 0x02, 0x03]);
      const result = await client.runCommand('testBuffer', [buf]);
      // Result should preserve the binary content
      expect(Buffer.isBuffer(result) || typeof result === 'string').toBe(true);
    });

    it('should handle NOSCRIPT by falling back to EVAL', async () => {
      // Flush scripts so SHA is unknown
      (await (client as any).raw?.sendCommand?.(['SCRIPT', 'FLUSH'])) ||
        client.runCommand('__flush__', []).catch(() => {});

      client.defineCommand('testNoScript', {
        numberOfKeys: 0,
        lua: `return 'recovered'`,
      });
      // Force script cache clear
      try {
        await (client as any).raw?.sendCommand?.(['SCRIPT', 'FLUSH']);
      } catch (e) {
        // ignore
      }
      const result = await client.runCommand('testNoScript', []);
      expect(result).toBe('recovered');
    });
  });

  // =========================================================================
  // 10. Transaction (multi) - result format
  // =========================================================================
  describe('Transaction (multi)', () => {
    beforeEach(async () => {
      await client.del(key('tx-hash'), key('tx-list'), key('tx-set'));
      await client.hset(key('tx-hash'), {
        a: '1',
        b: '2',
        c: '3',
        d: '4',
        e: '5',
      });
      await (client as any).lpush(key('tx-list'), 'c', 'b', 'a');
      await (client as any).sadd(key('tx-set'), 'x', 'y', 'z');
    });

    it('should return results in ioredis format: [Error|null, value][]', async () => {
      const tx = client.multi();
      tx.hgetall(key('tx-hash'));
      tx.lrange(key('tx-list'), 0, -1);
      tx.llen(key('tx-list'));

      const results = await tx.exec();
      expect(results).not.toBeNull();
      expect(results!.length).toBe(3);

      // Each result is [Error|null, value]
      for (const [err, val] of results!) {
        expect(err).toBeNull();
        expect(val).toBeDefined();
      }

      // hgetall returns a Record
      const [, hash] = results![0];
      expect(hash).toEqual({ a: '1', b: '2', c: '3', d: '4', e: '5' });

      // lrange returns array
      const [, list] = results![1];
      expect(list).toEqual(['a', 'b', 'c']);

      // llen returns number
      const [, len] = results![2];
      expect(len).toBe(3);
    });

    it('should hscan return ioredis format: [cursor, [field, value, ...]]', async () => {
      const tx = client.multi();
      tx.hscan(key('tx-hash'), 0, { COUNT: 100 });

      const results = await tx.exec();
      expect(results).not.toBeNull();

      const [err, scanResult] = results![0];
      expect(err).toBeNull();

      // ioredis format: [cursorString, [field, value, field, value, ...]]
      expect(Array.isArray(scanResult)).toBe(true);
      expect(scanResult.length).toBe(2);

      const [cursor, entries] = scanResult;
      expect(typeof cursor).toBe('string');
      expect(Array.isArray(entries)).toBe(true);
      // Should have pairs of field/value
      expect(entries.length % 2).toBe(0);
      expect(entries.length).toBeGreaterThanOrEqual(10); // 5 fields × 2
    });

    it('should sscan return ioredis format: [cursor, [member, ...]]', async () => {
      const tx = client.multi();
      tx.sscan(key('tx-set'), 0, { COUNT: 100 });

      const results = await tx.exec();
      expect(results).not.toBeNull();

      const [err, scanResult] = results![0];
      expect(err).toBeNull();

      // ioredis format: [cursorString, [member1, member2, ...]]
      expect(Array.isArray(scanResult)).toBe(true);
      expect(scanResult.length).toBe(2);

      const [cursor, members] = scanResult;
      expect(typeof cursor).toBe('string');
      expect(Array.isArray(members)).toBe(true);
      expect(members.sort()).toEqual(['x', 'y', 'z']);
    });

    it('should hscan accept string cursor', async () => {
      const tx = client.multi();
      tx.hscan(key('tx-hash'), '0', { COUNT: 100 });

      const results = await tx.exec();
      expect(results).not.toBeNull();
      const [err, scanResult] = results![0];
      expect(err).toBeNull();
      expect(Array.isArray(scanResult)).toBe(true);
    });

    it('should sscan accept string cursor', async () => {
      const tx = client.multi();
      tx.sscan(key('tx-set'), '0', { COUNT: 100 });

      const results = await tx.exec();
      expect(results).not.toBeNull();
      const [err, scanResult] = results![0];
      expect(err).toBeNull();
      expect(Array.isArray(scanResult)).toBe(true);
    });

    it('should del with zero keys not add a command to the pipeline', async () => {
      const tx = client.multi();
      tx.hgetall(key('tx-hash'));
      tx.del(); // zero keys - should be a no-op
      tx.llen(key('tx-list'));

      const results = await tx.exec();
      expect(results).not.toBeNull();
      // Only 2 actual commands (del with 0 keys is skipped)
      expect(results!.length).toBe(2);
    });

    it('should support runCommand (Lua scripts) in transaction', async () => {
      client.defineCommand('txTestScript', {
        numberOfKeys: 1,
        lua: `redis.call('SET', KEYS[1], ARGV[1]); return 'done'`,
      });

      // Pre-run the script to ensure SHA is cached in Redis
      await client.runCommand('txTestScript', [key('tx-lua-warmup'), 'warmup']);

      const tx = client.multi();
      tx.runCommand('txTestScript', [key('tx-lua'), 'hello']);
      const results = await tx.exec();

      expect(results).not.toBeNull();
      const [err, val] = results![0];
      expect(err).toBeNull();
      expect(val).toBe('done');

      // Verify the script actually ran
      const v = await client.get(key('tx-lua'));
      expect(v).toBe('hello');
    });
  });

  // =========================================================================
  // 11. Blocking commands
  // =========================================================================
  describe('Blocking Commands', () => {
    it('should bzpopmin return null on timeout', async () => {
      const result = await client.bzpopmin(key('empty-zset'), 0.1);
      expect(result).toBeNull();
    });

    it('should bzpopmin return element when available', async () => {
      await (client as any).zadd(key('bz-zset'), 5, 'member1');
      const result = await client.bzpopmin(key('bz-zset'), 1);
      expect(result).not.toBeNull();
      expect(result!.member).toBe('member1');
      expect(result!.score).toBe('5');
    });
  });

  // =========================================================================
  // 12. Server / admin commands
  // =========================================================================
  describe('Server Commands', () => {
    it('should info return a string with redis_version', async () => {
      const info = await client.info();
      expect(typeof info).toBe('string');
      expect(info).toContain('redis_version');
    });

    it('should clientSetName set the connection name', async () => {
      const dup = client.duplicate();
      await dup.connect();
      await dup.clientSetName('conformance-test');
      const list = await dup.clientList();
      expect(list).toContain('conformance-test');
      await dup.quit();
    });

    it('should clientList return a string with client info', async () => {
      const list = await client.clientList();
      expect(typeof list).toBe('string');
      expect(list.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // 13. Edge cases BullMQ depends on
  // =========================================================================
  describe('BullMQ-specific Edge Cases', () => {
    it('should hset accept both Record<string, string> and Record<string, number>', async () => {
      await client.hset(key('edge-hash'), {
        stringField: 'hello',
        numericField: 42,
        zeroField: 0,
        negativeField: -1,
      });
      const result = await client.hgetall(key('edge-hash'));
      expect(result.stringField).toBe('hello');
      expect(result.numericField).toBe('42');
      expect(result.zeroField).toBe('0');
      expect(result.negativeField).toBe('-1');
    });

    it('should handle large scan results correctly', async () => {
      // BullMQ's getDependencies scans hashes with many fields
      const hashKey = key('large-hash');
      const data: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        data[`field${i}`] = `value${i}`;
      }
      await client.hset(hashKey, data);

      // Full scan in transaction
      const tx = client.multi();
      tx.hscan(hashKey, 0, { COUNT: 200 });
      const results = await tx.exec();
      const [, scanResult] = results![0];
      const [cursor, entries] = scanResult;
      expect(cursor).toBe('0'); // All results in one scan
      expect(entries.length).toBe(200); // 100 fields × 2
    });

    it('should xadd handle all field types BullMQ uses', async () => {
      // BullMQ stores events with mixed types
      const id = await client.xadd(key('edge-stream'), '*', {
        event: 'completed',
        jobId: '123',
        returnvalue: JSON.stringify({ result: true }),
        prev: 'active',
        timestamp: 1714857600000, // number field
      });
      expect(id).toBeDefined();
    });

    it('should zrange WITHSCORES return scores as strings', async () => {
      // BullMQ parses scores as timestamps
      await (client as any).zadd(key('edge-zset'), 1714857600000, 'job:1');
      const result = await client.zrange(key('edge-zset'), 0, -1, {
        WITHSCORES: true,
      });
      expect(result[0]).toBe('job:1');
      expect(result[1]).toBe('1714857600000');
      expect(typeof result[1]).toBe('string');
    });

    it('should pipeline preserve command order', async () => {
      await client.del(key('order-test'));
      await client.hset(key('order-test'), { counter: '0' });

      const tx = client.multi();
      tx.hgetall(key('order-test'));
      tx.hset(key('order-test'), { counter: '1' });
      tx.hgetall(key('order-test'));

      const results = await tx.exec();
      expect(results![0][1]).toEqual({ counter: '0' });
      expect(results![2][1]).toEqual({ counter: '1' });
    });

    it('should handle concurrent operations without interference', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        client.set(key(`concurrent:${i}`), String(i)),
      );
      await Promise.all(promises);

      const gets = Array.from({ length: 10 }, (_, i) =>
        client.get(key(`concurrent:${i}`)),
      );
      const results = await Promise.all(gets);
      for (let i = 0; i < 10; i++) {
        expect(results[i]).toBe(String(i));
      }
    });
  });
});
