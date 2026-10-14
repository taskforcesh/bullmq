/**
 * Relay benchmark: Redis and PostgreSQL backends.
 *
 * Scenarios, for each backend:
 *   1. publish        Publishing with no subscribers (cost of the publish
 *                     script alone), `CONCURRENCY` publishes in flight.
 *   2. latency        End-to-end latency, from publish to the listener on another node,
 *                     one message at a time (no queueing).
 *   3. throughput     One subscriber, `CONCURRENCY` publishes in flight;
 *                     delivered messages per second and latency under load.
 *   4. fan-out        `FANOUT_NODES` nodes x `FANOUT_SUBS` subscriptions on the
 *                     same topic; deliveries per second.
 *   5. scaling        `M` exact subscriptions under the same first segment
 *                     (`jobs.<i>.cancel`, spread over 4 nodes) for each M in
 *                     `SCALE`; subscribe rate and publish latency to one of
 *                     them. Shows how the matching cost grows with the number
 *                     of subscriptions sharing a first segment.
 *   6. churn          Subscribe + unsubscribe pairs per second.
 *   7. wildcards      `W` wildcard subscriptions under the same first segment
 *                     (`cache.p<i>.*`) for each W in `WILDCARDS`; publish
 *                     rate to topics matching one of them.
 *   8. payloads       Throughput to one subscriber for each message size in
 *                     `PAYLOADS` (bytes).
 *
 * This is a smoke benchmark: it gives an order of magnitude on your machine,
 * not a rigorous, warmed-up, multi-sample study. Publisher and subscribers run
 * in this single process, sharing its event loop.
 *
 * Requirements:
 *   - A Redis server (REDIS_HOST / REDIS_PORT, default 127.0.0.1:6379).
 *   - A PostgreSQL server (POSTGRES_URL, default: the test suite's URL).
 *
 * Run:
 *   npx ts-node --project tsconfig-cjs.json benchmark/relay-benchmark.ts
 *
 * Options (env vars):
 *   BACKENDS       comma-separated backends (default redis,postgres)
 *   MESSAGES       messages for the publish/throughput scenarios (default 5000)
 *   PINGS          messages for the latency scenario (default 1000)
 *   CONCURRENCY    publishes in flight (default 50)
 *   PAYLOAD_BYTES  approximate message size (default 256)
 *   FANOUT_NODES   nodes in the fan-out scenario (default 5)
 *   FANOUT_SUBS    subscriptions per node in the fan-out scenario (default 10)
 *   SCALE          comma-separated subscription counts (default 100,1000,10000)
 *   WILDCARDS      comma-separated wildcard counts (default 10,100,1000)
 *   PAYLOADS       comma-separated message sizes (default 1024,16384,131072)
 */

import IORedis from 'ioredis';
import { Pool } from 'pg';
import { performance } from 'perf_hooks';
import { Relay } from '../src/classes/relay';
import { createPostgresRelayBackend } from '../src/postgres';
import { getPostgresUrl } from '../tests/postgres/utils/postgres-url';
import { randomUUID } from '../src/utils';

type Backend = 'redis' | 'postgres';

const env = (name: string, fallback: string) => process.env[name] || fallback;
const BACKENDS = env('BACKENDS', 'redis,postgres').split(',') as Backend[];
const MESSAGES = Number(env('MESSAGES', '5000'));
const PINGS = Number(env('PINGS', '1000'));
const CONCURRENCY = Number(env('CONCURRENCY', '50'));
const PAYLOAD_BYTES = Number(env('PAYLOAD_BYTES', '256'));
const FANOUT_NODES = Number(env('FANOUT_NODES', '5'));
const FANOUT_SUBS = Number(env('FANOUT_SUBS', '10'));
const SCALE = env('SCALE', '100,1000,10000').split(',').map(Number);
const WILDCARDS = env('WILDCARDS', '10,100,1000').split(',').map(Number);
const PAYLOADS = env('PAYLOADS', '1024,16384,131072').split(',').map(Number);

const REDIS = {
  host: env('REDIS_HOST', '127.0.0.1'),
  port: Number(env('REDIS_PORT', '6379')),
};
const PG_SCHEMA = 'bullmq_relay_bench';
const PREFIX = 'bull';

const padding = 'x'.repeat(Math.max(0, PAYLOAD_BYTES - 40));

interface Row {
  backend: Backend;
  scenario: string;
  ops: number;
  'ops/s': number;
  'p50 ms': string;
  'p95 ms': string;
  'p99 ms': string;
}

const rows: Row[] = [];

function percentile(sorted: number[], p: number): string {
  if (sorted.length === 0) {
    return '-';
  }
  const index = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length),
  );
  return sorted[index].toFixed(2);
}

function record(
  backend: Backend,
  scenario: string,
  ops: number,
  elapsedMs: number,
  latencies: number[],
) {
  const sorted = [...latencies].sort((a, b) => a - b);
  rows.push({
    backend,
    scenario,
    ops,
    'ops/s': Math.round((ops / elapsedMs) * 1000),
    'p50 ms': percentile(sorted, 50),
    'p95 ms': percentile(sorted, 95),
    'p99 ms': percentile(sorted, 99),
  });
  console.log(`  ${scenario}: ${Math.round((ops / elapsedMs) * 1000)} ops/s`);
}

/** Runs `count` tasks with at most `concurrency` in flight. */
async function runConcurrently(
  count: number,
  concurrency: number,
  task: (index: number) => Promise<void>,
) {
  let next = 0;
  const lanes = Array.from(
    { length: Math.min(concurrency, count) },
    async () => {
      while (next < count) {
        const index = next++;
        await task(index);
      }
    },
  );
  await Promise.all(lanes);
}

function waitUntil(
  predicate: () => boolean,
  timeoutMs = 120_000,
): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) {
        return resolve();
      }
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('timed out waiting for deliveries'));
      }
      setTimeout(check, 5);
    };
    check();
  });
}

class Harness {
  private relays: Relay<any>[] = [];
  private namespaces: string[] = [];

  constructor(readonly backend: Backend) {}

  namespace(): string {
    const namespace = `bench-${randomUUID().slice(0, 8)}`;
    this.namespaces.push(namespace);
    return namespace;
  }

  async relay(namespace: string): Promise<Relay<any>> {
    const relay: Relay<any> =
      this.backend === 'redis'
        ? new Relay({ connection: REDIS, prefix: PREFIX, namespace })
        : new Relay({
            connection: {
              connectionString: getPostgresUrl(),
              schema: PG_SCHEMA,
              migrate: true,
            },
            backend: createPostgresRelayBackend,
            namespace,
          });
    relay.on('error', err => console.error(`  relay error: ${err.message}`));
    this.relays.push(relay);
    await relay.waitUntilReady();
    return relay;
  }

  async reset(): Promise<void> {
    await Promise.all(this.relays.splice(0).map(relay => relay.close()));
    const namespaces = this.namespaces.splice(0);
    if (this.backend === 'redis') {
      const client = new IORedis(REDIS);
      for (const namespace of namespaces) {
        const keys = await client.keys(`${PREFIX}::relay:{${namespace}}:*`);
        if (keys.length > 0) {
          await client.del(...keys);
        }
      }
      await client.quit();
    } else {
      const pool = new Pool({ connectionString: getPostgresUrl() });
      for (const namespace of namespaces) {
        await pool.query(
          `DELETE FROM "${PG_SCHEMA}".relay_node WHERE ns = $1`,
          [namespace],
        );
        await pool.query(
          `DELETE FROM "${PG_SCHEMA}".relay_retained WHERE ns = $1`,
          [namespace],
        );
      }
      await pool.end();
    }
  }
}

async function publishWithoutSubscribers(h: Harness) {
  const publisher = await h.relay(h.namespace());
  const latencies: number[] = [];
  const start = performance.now();
  await runConcurrently(MESSAGES, CONCURRENCY, async i => {
    const t = performance.now();
    await publisher.publish(`bench.none.${i % 100}`, { i, padding });
    latencies.push(performance.now() - t);
  });
  record(
    h.backend,
    'publish (no subscribers)',
    MESSAGES,
    performance.now() - start,
    latencies,
  );
  await h.reset();
}

async function latency(h: Harness) {
  const ns = h.namespace();
  const subscriber = await h.relay(ns);
  const publisher = await h.relay(ns);
  const latencies: number[] = [];
  let resolveDelivery: (() => void) | undefined;
  await subscriber.subscribe('bench.latency', message => {
    latencies.push(performance.now() - (message.data as { t: number }).t);
    resolveDelivery?.();
  });
  const start = performance.now();
  for (let i = 0; i < PINGS; i++) {
    const delivered = new Promise<void>(resolve => (resolveDelivery = resolve));
    await publisher.publish('bench.latency', { t: performance.now(), padding });
    await delivered;
  }
  record(
    h.backend,
    'end-to-end latency (one at a time)',
    PINGS,
    performance.now() - start,
    latencies,
  );
  await h.reset();
}

async function throughput(h: Harness) {
  const ns = h.namespace();
  const subscriber = await h.relay(ns);
  const publisher = await h.relay(ns);
  const latencies: number[] = [];
  await subscriber.subscribe('bench.throughput.*', message => {
    latencies.push(performance.now() - (message.data as { t: number }).t);
  });
  const start = performance.now();
  await runConcurrently(MESSAGES, CONCURRENCY, async i => {
    await publisher.publish(`bench.throughput.${i % 10}`, {
      t: performance.now(),
      padding,
    });
  });
  await waitUntil(() => latencies.length >= MESSAGES);
  record(
    h.backend,
    `throughput (1 subscriber, ${CONCURRENCY} in flight)`,
    MESSAGES,
    performance.now() - start,
    latencies,
  );
  await h.reset();
}

async function fanOut(h: Harness) {
  const ns = h.namespace();
  const latencies: number[] = [];
  for (let n = 0; n < FANOUT_NODES; n++) {
    const node = await h.relay(ns);
    for (let s = 0; s < FANOUT_SUBS; s++) {
      await node.subscribe('bench.fanout', message => {
        latencies.push(performance.now() - (message.data as { t: number }).t);
      });
    }
  }
  const publisher = await h.relay(ns);
  const messages = Math.ceil(MESSAGES / 5);
  const expected = messages * FANOUT_NODES * FANOUT_SUBS;
  const start = performance.now();
  await runConcurrently(messages, CONCURRENCY, async () => {
    await publisher.publish('bench.fanout', { t: performance.now(), padding });
  });
  await waitUntil(() => latencies.length >= expected);
  record(
    h.backend,
    `fan-out deliveries (${FANOUT_NODES} nodes x ${FANOUT_SUBS} subs)`,
    expected,
    performance.now() - start,
    latencies,
  );
  await h.reset();
}

async function scaling(h: Harness) {
  for (const count of SCALE) {
    const ns = h.namespace();
    const nodes = await Promise.all([0, 1, 2, 3].map(() => h.relay(ns)));
    let delivered = 0;

    const subscribeLatencies: number[] = [];
    const subscribeStart = performance.now();
    await runConcurrently(count, CONCURRENCY, async i => {
      const t = performance.now();
      await nodes[i % nodes.length].subscribe(`jobs.${i}.cancel`, () => {
        delivered++;
      });
      subscribeLatencies.push(performance.now() - t);
    });
    record(
      h.backend,
      `subscribe (${count} subs)`,
      count,
      performance.now() - subscribeStart,
      subscribeLatencies,
    );

    const publisher = await h.relay(ns);
    const messages = Math.min(MESSAGES, 1000);
    const latencies: number[] = [];
    const start = performance.now();
    await runConcurrently(messages, CONCURRENCY, async i => {
      const t = performance.now();
      await publisher.publish(`jobs.${(i * 7919) % count}.cancel`, { padding });
      latencies.push(performance.now() - t);
    });
    await waitUntil(() => delivered >= messages);
    record(
      h.backend,
      `publish to 1 of ${count} subs`,
      messages,
      performance.now() - start,
      latencies,
    );
    await h.reset();
  }
}

async function churn(h: Harness) {
  const node = await h.relay(h.namespace());
  const ops = Math.min(MESSAGES, 2000);
  const latencies: number[] = [];
  const start = performance.now();
  await runConcurrently(ops, CONCURRENCY, async i => {
    const t = performance.now();
    const subscription = await node.subscribe(`churn.${i}.x`, () => undefined);
    await subscription.unsubscribe();
    latencies.push(performance.now() - t);
  });
  record(
    h.backend,
    'subscribe + unsubscribe',
    ops,
    performance.now() - start,
    latencies,
  );
  await h.reset();
}

async function wildcards(h: Harness) {
  for (const count of WILDCARDS) {
    const ns = h.namespace();
    const nodes = await Promise.all([0, 1, 2, 3].map(() => h.relay(ns)));
    let delivered = 0;
    for (let i = 0; i < count; i++) {
      await nodes[i % nodes.length].subscribe(`cache.p${i}.*`, () => {
        delivered++;
      });
    }
    const publisher = await h.relay(ns);
    const messages = Math.min(MESSAGES, 1000);
    const latencies: number[] = [];
    const start = performance.now();
    await runConcurrently(messages, CONCURRENCY, async i => {
      const t = performance.now();
      await publisher.publish(`cache.p${(i * 7919) % count}.x`, { padding });
      latencies.push(performance.now() - t);
    });
    await waitUntil(() => delivered >= messages);
    record(
      h.backend,
      `publish to 1 of ${count} wildcard subs`,
      messages,
      performance.now() - start,
      latencies,
    );
    await h.reset();
  }
}

async function payloads(h: Harness) {
  for (const size of PAYLOADS) {
    const ns = h.namespace();
    const subscriber = await h.relay(ns);
    const publisher = await h.relay(ns);
    const body = 'x'.repeat(size);
    const messages = Math.min(MESSAGES, 1000);
    const latencies: number[] = [];
    await subscriber.subscribe('bench.payload', message => {
      latencies.push(performance.now() - (message.data as { t: number }).t);
    });
    const start = performance.now();
    await runConcurrently(messages, CONCURRENCY, async () => {
      await publisher.publish('bench.payload', { t: performance.now(), body });
    });
    await waitUntil(() => latencies.length >= messages);
    record(
      h.backend,
      `throughput, ${Math.round(size / 1024)} KiB messages`,
      messages,
      performance.now() - start,
      latencies,
    );
    await h.reset();
  }
}

async function main() {
  console.log(
    `Relay benchmark: ${MESSAGES} messages, ${CONCURRENCY} in flight, ~${PAYLOAD_BYTES} bytes per message`,
  );
  if (BACKENDS.includes('postgres')) {
    // Start from a fresh schema, so the current migrations are applied.
    const pool = new Pool({ connectionString: getPostgresUrl() });
    await pool.query(`DROP SCHEMA IF EXISTS "${PG_SCHEMA}" CASCADE`);
    await pool.end();
  }
  for (const backend of BACKENDS) {
    console.log(`\n${backend}`);
    const h = new Harness(backend);
    for (const scenario of [
      publishWithoutSubscribers,
      latency,
      throughput,
      fanOut,
      scaling,
      churn,
      wildcards,
      payloads,
    ]) {
      try {
        await scenario(h);
      } catch (err) {
        console.error(`  ${scenario.name} failed: ${(err as Error).message}`);
        await h.reset();
      }
    }
  }
  console.log();
  console.table(rows);
}

main().then(
  () => process.exit(0),
  err => {
    console.error(err);
    process.exit(1);
  },
);
