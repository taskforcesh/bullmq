import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { createValkeyGlideClient } from '../src/classes/valkey-glide-client';

type GlideArg = string | Buffer;

class MockGlideClient {
  static instances: MockGlideClient[] = [];

  readonly config: Record<string, any>;
  readonly commands: string[][] = [];
  private transactionQueue: GlideArg[][] | null = null;
  private readonly values = new Map<string, string>();
  private readonly hashes = new Map<string, Record<string, string>>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly scripts = new Set<string>();

  constructor(config: Record<string, any> = {}) {
    this.config = config;
    MockGlideClient.instances.push(this);
  }

  static async createClient(config: Record<string, any>) {
    return new MockGlideClient(config);
  }

  close(): void {
    // no-op
  }

  async customCommand(args: GlideArg[]): Promise<any> {
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
        if (this.values.delete(tokens[i]) || this.hashes.delete(tokens[i])) {
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

    if (cmd === 'LLEN') {
      return 0;
    }

    if (cmd === 'LRANGE') {
      return [];
    }

    if (cmd === 'LPOS') {
      return null;
    }

    if (cmd === 'LTRIM') {
      return 'OK';
    }

    if (cmd === 'ZRANGE' || cmd === 'ZREVRANGE') {
      return [];
    }

    if (cmd === 'ZCARD') {
      return 0;
    }

    if (cmd === 'ZSCORE') {
      return null;
    }

    if (cmd === 'XADD') {
      return '1-0';
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

    if (cmd === 'BZPOPMIN') {
      return ['queue', 'job1', '10'];
    }

    if (cmd === 'SCAN') {
      return ['0', [...this.values.keys(), ...this.hashes.keys()]];
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

    return null;
  }
}

describe('valkey glide adapter', () => {
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

  it('falls back from EVALSHA to EVAL on NOSCRIPT', async () => {
    const raw = new MockGlideClient();
    const client = createValkeyGlideClient(raw as any);

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
});
