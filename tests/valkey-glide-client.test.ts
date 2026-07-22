import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { createValkeyGlideClient } from '../src/classes/valkey-glide-client';
import { ConnectionClosedError } from '../src/classes/errors/connection-closed-error';

type GlideArg = string | Buffer;
type GlideCommandOptions = {
  decoder?: number;
};

const GLIDE_STRING_DECODER = 1;

async function withMockedRuntimeModule<T>(
  requestToMock: string,
  exports: Record<string, unknown>,
  callback: () => Promise<T>,
): Promise<T> {
  const module = require('module') as typeof import('module') & {
    _load: (...args: any[]) => any;
  };
  const originalLoad = module._load;

  module._load = function (
    request: string,
    parent: NodeModule | null,
    isMain: boolean,
  ) {
    if (request === requestToMock) {
      return exports;
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return await callback();
  } finally {
    module._load = originalLoad;
  }
}

class MockGlideClient {
  static instances: MockGlideClient[] = [];

  readonly config: Record<string, any>;
  readonly commands: string[][] = [];
  closeCalls = 0;
  private transactionQueue: GlideArg[][] | null = null;
  private readonly values = new Map<string, string>();
  private readonly hashes = new Map<string, Record<string, string>>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly zsets = new Map<string, Map<string, string>>();
  private readonly lists = new Map<string, string[]>();
  private readonly streams = new Map<
    string,
    Array<{ id: string; fields: string[] }>
  >();
  private readonly scripts = new Set<string>();

  constructor(config: Record<string, any> = {}) {
    this.config = config;
    MockGlideClient.instances.push(this);
  }

  static async createClient(config: Record<string, any>) {
    return new MockGlideClient(config);
  }

  close(): void {
    this.closeCalls++;
  }

  async customCommand(
    args: GlideArg[],
    _options?: GlideCommandOptions,
  ): Promise<any> {
    if (this.transactionQueue && !this.isTransactionControl(args)) {
      this.transactionQueue.push(args);
      return 'QUEUED';
    }

    return this.executeImmediately(args);
  }

  private isTransactionControl(args: GlideArg[]): boolean {
    const cmd = String(args[0]).toUpperCase();
    return cmd === 'MULTI' || cmd === 'EXEC' || cmd === 'DISCARD';
  }

  private async executeImmediately(args: GlideArg[]): Promise<any> {
    const tokens = args.map(arg =>
      Buffer.isBuffer(arg) ? arg.toString() : String(arg),
    );
    this.commands.push(tokens);

    const cmd = tokens[0].toUpperCase();

    if (cmd === 'MULTI') {
      this.transactionQueue = [];
      return 'OK';
    }

    if (cmd === 'DISCARD') {
      this.transactionQueue = null;
      return 'OK';
    }

    if (cmd === 'EXEC') {
      const queue = this.transactionQueue ?? [];
      this.transactionQueue = null;
      const results: any[] = [];
      for (const command of queue) {
        results.push(await this.executeImmediately(command));
      }
      return results;
    }

    if (cmd === 'CLIENT' && tokens[1]?.toUpperCase() === 'SETNAME') {
      return 'OK';
    }

    if (cmd === 'CLIENT' && tokens[1]?.toUpperCase() === 'LIST') {
      return 'id=1 name=mock';
    }

    if (cmd === 'SCRIPT' && tokens[1]?.toUpperCase() === 'LOAD') {
      const sha = createHash('sha1').update(tokens[2]).digest('hex');
      this.scripts.add(sha);
      return sha;
    }

    if (cmd === 'SET') {
      this.values.set(tokens[1], tokens[2]);
      return 'OK';
    }

    if (cmd === 'GET') {
      return this.values.get(tokens[1]) ?? null;
    }

    if (cmd === 'DEL') {
      let deleted = 0;
      for (let i = 1; i < tokens.length; i++) {
        if (
          this.values.delete(tokens[i]) ||
          this.hashes.delete(tokens[i]) ||
          this.sets.delete(tokens[i]) ||
          this.zsets.delete(tokens[i]) ||
          this.lists.delete(tokens[i]) ||
          this.streams.delete(tokens[i])
        ) {
          deleted++;
        }
      }
      return deleted;
    }

    if (cmd === 'HSET') {
      const key = tokens[1];
      const hash = this.hashes.get(key) ?? {};
      let added = 0;
      for (let i = 2; i < tokens.length; i += 2) {
        if (!(tokens[i] in hash)) {
          added++;
        }
        hash[tokens[i]] = tokens[i + 1];
      }
      this.hashes.set(key, hash);
      return added;
    }

    if (cmd === 'HGET') {
      return this.hashes.get(tokens[1])?.[tokens[2]] ?? null;
    }

    if (cmd === 'HMGET') {
      const hash = this.hashes.get(tokens[1]) ?? {};
      return tokens.slice(2).map(field => hash[field] ?? null);
    }

    if (cmd === 'HGETALL') {
      const hash = this.hashes.get(tokens[1]) ?? {};
      return Object.entries(hash).map(([key, value]) => ({ key, value }));
    }

    if (cmd === 'HDEL') {
      const hash = this.hashes.get(tokens[1]) ?? {};
      let deleted = 0;
      for (const field of tokens.slice(2)) {
        if (field in hash) {
          delete hash[field];
          deleted++;
        }
      }
      this.hashes.set(tokens[1], hash);
      return deleted;
    }

    if (cmd === 'HEXISTS') {
      const hash = this.hashes.get(tokens[1]) ?? {};
      return tokens[2] in hash;
    }

    if (cmd === 'SMEMBERS') {
      return Array.from(this.sets.get(tokens[1]) ?? []);
    }

    if (cmd === 'SADD') {
      const set = this.sets.get(tokens[1]) ?? new Set<string>();
      let added = 0;
      for (const member of tokens.slice(2)) {
        if (!set.has(member)) {
          added++;
        }
        set.add(member);
      }
      this.sets.set(tokens[1], set);
      return added;
    }

    if (cmd === 'SCARD') {
      return (this.sets.get(tokens[1]) ?? new Set()).size;
    }

    if (cmd === 'LLEN') {
      return (this.lists.get(tokens[1]) ?? []).length;
    }

    if (cmd === 'LRANGE') {
      return [...(this.lists.get(tokens[1]) ?? [])];
    }

    if (cmd === 'LPOS') {
      return null;
    }

    if (cmd === 'LTRIM') {
      return 'OK';
    }

    if (cmd === 'LPUSH') {
      const list = this.lists.get(tokens[1]) ?? [];
      for (const value of tokens.slice(2)) {
        list.unshift(value);
      }
      this.lists.set(tokens[1], list);
      return list.length;
    }

    if (cmd === 'RPOP') {
      const list = this.lists.get(tokens[1]) ?? [];
      return list.pop() ?? null;
    }

    if (cmd === 'ZRANGE' || cmd === 'ZREVRANGE') {
      const entries = Array.from(
        this.zsets.get(tokens[1])?.entries() ?? [],
      ).sort((a, b) => Number(a[1]) - Number(b[1]));
      return entries.map(([member]) => member);
    }

    if (cmd === 'ZCARD') {
      return (this.zsets.get(tokens[1]) ?? new Map()).size;
    }

    if (cmd === 'ZSCORE') {
      return this.zsets.get(tokens[1])?.get(tokens[2]) ?? null;
    }

    if (cmd === 'ZADD') {
      const zset = this.zsets.get(tokens[1]) ?? new Map<string, string>();
      let added = 0;
      for (let i = 2; i < tokens.length; i += 2) {
        const score = tokens[i];
        const member = tokens[i + 1];
        if (!zset.has(member)) {
          added++;
        }
        zset.set(member, score);
      }
      this.zsets.set(tokens[1], zset);
      return added;
    }

    if (cmd === 'ZREM') {
      const zset = this.zsets.get(tokens[1]) ?? new Map<string, string>();
      let removed = 0;
      for (const member of tokens.slice(2)) {
        if (zset.delete(member)) {
          removed++;
        }
      }
      this.zsets.set(tokens[1], zset);
      return removed;
    }

    if (cmd === 'XADD') {
      const stream = this.streams.get(tokens[1]) ?? [];
      const id = tokens[2] === '*' ? `${stream.length + 1}-0` : tokens[2];
      stream.push({ id, fields: tokens.slice(3) });
      this.streams.set(tokens[1], stream);
      return id;
    }

    if (cmd === 'XREAD') {
      return [
        {
          key: 'stream',
          value: [{ key: '1-0', value: [{ key: 'field', value: 'value' }] }],
        },
      ];
    }

    if (cmd === 'XTRIM') {
      return 1;
    }

    if (cmd === 'XLEN') {
      return (this.streams.get(tokens[1]) ?? []).length;
    }

    if (cmd === 'XREVRANGE') {
      const stream = [...(this.streams.get(tokens[1]) ?? [])].reverse();
      const countIndex = tokens.findIndex(
        token => token.toUpperCase() === 'COUNT',
      );
      const limited =
        countIndex >= 0
          ? stream.slice(0, Number(tokens[countIndex + 1]))
          : stream;
      return limited.map(entry => ({
        key: entry.id,
        value: entry.fields
          .map((field, index) =>
            index % 2 === 0
              ? { key: field, value: entry.fields[index + 1] }
              : null,
          )
          .filter(Boolean),
      }));
    }

    if (cmd === 'BZPOPMIN') {
      return ['queue', 'job1', '10'];
    }

    if (cmd === 'SCAN') {
      return [
        '0',
        [
          ...this.values.keys(),
          ...this.hashes.keys(),
          ...this.sets.keys(),
          ...this.zsets.keys(),
          ...this.lists.keys(),
          ...this.streams.keys(),
        ],
      ];
    }

    if (cmd === 'KEYS') {
      const pattern = new RegExp(
        `^${tokens[1].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
      );
      return [
        ...this.values.keys(),
        ...this.hashes.keys(),
        ...this.sets.keys(),
        ...this.zsets.keys(),
        ...this.lists.keys(),
        ...this.streams.keys(),
      ].filter(key => pattern.test(key));
    }

    if (cmd === 'EXISTS') {
      return tokens
        .slice(1)
        .filter(
          key =>
            this.values.has(key) ||
            this.hashes.has(key) ||
            this.sets.has(key) ||
            this.zsets.has(key) ||
            this.lists.has(key) ||
            this.streams.has(key),
        ).length;
    }

    if (cmd === 'HSCAN') {
      return ['0', ['field', 'value']];
    }

    if (cmd === 'SSCAN') {
      return ['0', ['a', 'b']];
    }

    if (cmd === 'EVALSHA') {
      if (!this.scripts.has(tokens[1])) {
        throw new Error('NOSCRIPT No matching script. Please use EVAL.');
      }
      return 'script-result';
    }

    if (cmd === 'EVAL') {
      const script = tokens[1];
      const sha = createHash('sha1').update(script).digest('hex');
      this.scripts.add(sha);
      return 'script-result';
    }

    if (cmd === 'INFO') {
      return 'redis_version:7.2.0';
    }

    if (cmd === 'INCR') {
      const value = Number(this.values.get(tokens[1]) ?? '0') + 1;
      this.values.set(tokens[1], String(value));
      return value;
    }

    if (cmd === 'INCRBY') {
      const value =
        Number(this.values.get(tokens[1]) ?? '0') + Number(tokens[2]);
      this.values.set(tokens[1], String(value));
      return value;
    }

    if (cmd === 'FLUSHALL') {
      this.values.clear();
      this.hashes.clear();
      this.sets.clear();
      this.zsets.clear();
      this.lists.clear();
      this.streams.clear();
      return 'OK';
    }

    return null;
  }
}

describe('ValkeyGlideAdapter', () => {
  it('preserves the raw constructor context when duplicating clients', async () => {
    class ContextAwareGlideClient extends MockGlideClient {
      static async createClient(config: Record<string, any>) {
        if (this !== ContextAwareGlideClient) {
          throw new Error('lost createClient context');
        }

        return new ContextAwareGlideClient(config);
      }
    }

    const raw = new ContextAwareGlideClient({
      addresses: [{ host: 'localhost', port: 6379 }],
    });
    const client = createValkeyGlideClient(raw as any);

    const duplicate = client.duplicate({ connectionName: 'worker' });

    await expect(duplicate.connect()).resolves.toBeUndefined();
  });

  it('maps core commands and normalizes responses', async () => {
    const raw = new MockGlideClient({
      addresses: [{ host: 'localhost', port: 6379 }],
    });
    const client = createValkeyGlideClient(raw as any);

    await client.connect();
    await client.set('foo', 'bar', { PX: 500 });
    await client.hset('hash', { a: 1, b: 2 });

    expect(await client.get('foo')).toBe('bar');
    expect(await client.hgetall('hash')).toEqual({ a: '1', b: '2' });
    expect(await client.scan('0', { MATCH: '*' })).toEqual([
      '0',
      ['foo', 'hash'],
    ]);
    expect(await client.xread([{ key: 'stream', id: '0-0' }])).toEqual([
      ['stream', [['1-0', ['field', 'value']]]],
    ]);

    expect(raw.commands).toContainEqual(['SET', 'foo', 'bar', 'PX', '500']);
  });

  it('supports ioredis-compatible helper commands used by the test suite', async () => {
    const raw = new MockGlideClient();
    const client = createValkeyGlideClient(raw as any) as any;

    await client.sadd('set', 'a', 'b');
    await client.zadd('sorted', 1, 'job-1', 2, 'job-2');
    await client.lpush('list', 'a', 'b');
    await client.xadd('events', '*', { event: 'completed', jobId: '1' });
    await client.incrby('counter', 4);

    expect(await client.keys('*')).toEqual(
      expect.arrayContaining(['set', 'sorted', 'list', 'events', 'counter']),
    );
    expect(await client.exists('set', 'missing')).toBe(1);
    expect(await client.scard('set')).toBe(2);
    expect(await client.zcard('sorted')).toBe(2);
    expect(await client.zrem('sorted', 'job-1')).toBe(1);
    expect(await client.xlen('events')).toBe(1);
    expect(await client.xrevrange('events', '+', '-', 'COUNT', 1)).toEqual([
      ['1-0', ['event', 'completed', 'jobId', '1']],
    ]);
    expect(await client.rpop('list')).toBe('a');
    expect(await client.incr('counter')).toBe(5);
    expect(await client.flushall()).toBe('OK');
    expect(
      await client.exists('set', 'sorted', 'list', 'events', 'counter'),
    ).toBe(0);
  });

  it('falls back from EVALSHA to EVAL on NOSCRIPT', async () => {
    const raw = new MockGlideClient();
    const client = createValkeyGlideClient(raw as any);
    const originalCustomCommand = raw.customCommand.bind(raw);

    raw.customCommand = async (command: any[]) => {
      if (command[0] === 'SCRIPT' && command[1] === 'LOAD') {
        raw.commands.push(
          command.map(token =>
            Buffer.isBuffer(token) ? token.toString() : String(token),
          ),
        );
        return null;
      }

      return originalCustomCommand(command);
    };

    client.defineCommand('myScript', {
      numberOfKeys: 1,
      lua: 'return ARGV[1]',
    });

    expect(await client.runCommand('myScript', ['k1', 'v1'])).toBe(
      'script-result',
    );

    const evalShaCalls = raw.commands.filter(cmd => cmd[0] === 'EVALSHA');
    const evalCalls = raw.commands.filter(cmd => cmd[0] === 'EVAL');

    expect(evalShaCalls.length).toBe(1);
    expect(evalCalls.length).toBe(1);
  });

  it('falls back from EVALSHA to EVAL on NoScriptError', async () => {
    const raw = new MockGlideClient();
    const client = createValkeyGlideClient(raw as any);
    const originalCustomCommand = raw.customCommand.bind(raw);
    let shouldFailEvalSha = true;

    raw.customCommand = async (command: any[]) => {
      if (command[0] === 'EVALSHA' && shouldFailEvalSha) {
        shouldFailEvalSha = false;
        raw.commands.push(
          command.map(token =>
            Buffer.isBuffer(token) ? token.toString() : String(token),
          ),
        );
        throw new Error(
          'An error was signalled by the server: - NoScriptError: No matching script.',
        );
      }
      return originalCustomCommand(command);
    };

    client.defineCommand('myScript', {
      numberOfKeys: 1,
      lua: 'return ARGV[1]',
    });

    expect(await client.runCommand('myScript', ['k1', 'v1'])).toBe(
      'script-result',
    );

    const evalShaCalls = raw.commands.filter(cmd => cmd[0] === 'EVALSHA');
    const evalCalls = raw.commands.filter(cmd => cmd[0] === 'EVAL');

    expect(evalShaCalls.length).toBe(1);
    expect(evalCalls.length).toBe(1);
  });

  it('duplicates client via createClient and applies connectionName', async () => {
    MockGlideClient.instances.splice(0);

    const raw = new MockGlideClient({
      addresses: [{ host: 'localhost', port: 6379 }],
    });
    const client = createValkeyGlideClient(raw as any);

    const duplicate = client.duplicate({ connectionName: 'worker' });
    await duplicate.connect();

    expect(MockGlideClient.instances.length).toBe(2);
    expect(MockGlideClient.instances[1].commands).toContainEqual([
      'CLIENT',
      'SETNAME',
      'worker',
    ]);
  });

  it('reconnects duplicated clients after disconnecting', async () => {
    MockGlideClient.instances.splice(0);

    const raw = new MockGlideClient({
      addresses: [{ host: 'localhost', port: 6379 }],
    });
    const client = createValkeyGlideClient(raw as any);

    const duplicate = client.duplicate({ connectionName: 'worker' });
    await duplicate.connect();

    duplicate.disconnect();
    await duplicate.connect();

    expect(MockGlideClient.instances.length).toBe(3);
    expect(MockGlideClient.instances[2].commands).toContainEqual([
      'CLIENT',
      'SETNAME',
      'worker',
    ]);
  });

  it('uses the string decoder for CLIENT commands', async () => {
    const raw = new MockGlideClient();
    const client = createValkeyGlideClient(raw as any) as any;
    const calls: Array<{ args: string[]; options?: GlideCommandOptions }> = [];
    const originalCustomCommand = raw.customCommand.bind(raw);

    raw.customCommand = async (
      args: GlideArg[],
      options?: GlideCommandOptions,
    ) => {
      calls.push({
        args: args.map(arg =>
          Buffer.isBuffer(arg) ? arg.toString() : String(arg),
        ),
        options,
      });
      return originalCustomCommand(args, options);
    };

    await client.clientSetName('worker');
    await client.clientList();

    expect(calls).toEqual([
      {
        args: ['CLIENT', 'SETNAME', 'worker'],
        options: { decoder: GLIDE_STRING_DECODER },
      },
      {
        args: ['CLIENT', 'LIST'],
        options: { decoder: GLIDE_STRING_DECODER },
      },
    ]);
  });

  it('supports MULTI/pipeline style transactions', async () => {
    const raw = new MockGlideClient();
    const client = createValkeyGlideClient(raw as any);

    const tx = client.multi();
    tx.hset('hash', { field: 'value' });
    tx.hgetall('hash');
    tx.hscan('hash', '0');
    tx.sscan('set', '0');

    const results = await tx.exec();

    expect(results).toEqual([
      [null, 1],
      [null, { field: 'value' }],
      [null, ['0', ['field', 'value']]],
      [null, ['0', ['a', 'b']]],
    ]);
  });

  it('uses string decoder while queueing MULTI commands', async () => {
    const raw = new MockGlideClient();
    const client = createValkeyGlideClient(raw as any);
    const originalCustomCommand = raw.customCommand.bind(raw);
    let multiStarted = false;

    raw.customCommand = async (
      args: GlideArg[],
      options?: GlideCommandOptions,
    ) => {
      const cmd = String(args[0]).toUpperCase();
      if (cmd === 'MULTI') {
        multiStarted = true;
      } else if (cmd === 'EXEC' || cmd === 'DISCARD') {
        multiStarted = false;
      } else if (multiStarted && cmd === 'HGETALL' && options?.decoder !== 1) {
        throw new Error(
          `Response couldn't be converted to map - TypeError: (response was "SimpleString")`,
        );
      }
      return originalCustomCommand(args, options);
    };

    const tx = client.multi();
    tx.hset('hash', { field: 'value' });
    tx.hgetall('hash');

    await expect(tx.exec()).resolves.toEqual([
      [null, 1],
      [null, { field: 'value' }],
    ]);
  });

  it('uses native batch execution when available', async () => {
    const raw = new MockGlideClient();
    const client = createValkeyGlideClient(raw as any);
    let execCalls = 0;
    let executedBatch: { commands: GlideArg[][] } | undefined;

    class MockBatch {
      commands: GlideArg[][] = [];

      constructor(_isAtomic: boolean) {}

      customCommand(args: GlideArg[]) {
        this.commands.push(args);
      }
    }

    (raw as any).exec = async (batch: MockBatch) => {
      execCalls++;
      executedBatch = batch;
      return [1, { field: 'value' }];
    };

    raw.customCommand = async (args: GlideArg[]) => {
      const cmd = String(args[0]).toUpperCase();

      if (cmd === 'MULTI' || cmd === 'EXEC' || cmd === 'DISCARD') {
        throw new Error('manual transaction path should not be used');
      }

      return 'OK';
    };

    await withMockedRuntimeModule(
      '@valkey/valkey-glide',
      { Batch: MockBatch },
      async () => {
        const tx = client.multi();
        tx.hset('hash', { field: 'value' });
        tx.hgetall('hash');

        await expect(tx.exec()).resolves.toEqual([
          [null, 1],
          [null, { field: 'value' }],
        ]);
      },
    );

    expect(execCalls).toBe(1);
    expect(executedBatch?.commands).toEqual([
      ['HSET', 'hash', 'field', 'value'],
      ['HGETALL', 'hash'],
    ]);
  });

  it('reports wait status until connect is called', async () => {
    const raw = new MockGlideClient();
    const client = createValkeyGlideClient(raw as any);

    expect(client.status).toBe('wait');
    await client.connect();
    expect(client.status).toBe('ready');
  });

  it('emits ready again after disconnect and reconnect', async () => {
    const raw = new MockGlideClient();
    const client = createValkeyGlideClient(raw as any);
    let readyCount = 0;

    client.on('ready', () => {
      readyCount++;
    });

    await client.connect();
    client.disconnect();
    await client.connect();

    expect(readyCount).toBe(2);
  });

  it('waits for in-flight commands before closing the raw client', async () => {
    let resolveInfo: () => void;
    const infoStarted = new Promise<void>(resolve => {
      resolveInfo = resolve;
    });

    const raw = new MockGlideClient();
    const originalCustomCommand = raw.customCommand.bind(raw);

    raw.customCommand = async (command: GlideArg[]) => {
      if (String(command[0]).toUpperCase() === 'INFO') {
        raw.commands.push(command.map(arg => String(arg)));
        resolveInfo!();
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        return 'redis_version:7.2.0';
      }

      return originalCustomCommand(command);
    };

    const client = createValkeyGlideClient(raw as any);

    const infoPromise = client.info();
    await infoStarted;

    client.disconnect();
    expect(raw.closeCalls).toBe(0);

    await expect(infoPromise).resolves.toBe('redis_version:7.2.0');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(raw.closeCalls).toBe(1);
  });

  it('throws ConnectionClosedError for commands issued after disconnect', async () => {
    const raw = new MockGlideClient();
    const client = createValkeyGlideClient(raw as any);

    client.disconnect();

    await expect(client.info()).rejects.toBeInstanceOf(ConnectionClosedError);
  });
});
