import { RedisClient } from 'bun';
import { createBunRedisClient } from './src/classes/bun-redis-client.ts';
import { Queue } from './dist/esm/classes/queue.js';
import { Worker } from './dist/esm/classes/worker.js';
import { RedisConnection } from './dist/esm/classes/redis-connection.js';
import { FlowProducer } from './dist/esm/classes/flow-producer.js';

RedisConnection.clientFactory = () => {
  const raw = new RedisClient('redis://localhost:6379');
  return createBunRedisClient(raw);
};

const connection = { host: 'localhost', port: 6379 };
const prefix = 'bun-suite';
const queueName = 'bun-s-' + Date.now();
let passed = 0,
  failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e: any) {
    failed++;
    console.log('  ✗ ' + name + ': ' + e.message);
  }
}

console.log('Bun Redis Adapter - Integration Tests\n');

// --- Queue operations ---
console.log('Queue operations:');

await test('add and get job', async () => {
  const q = new Queue(queueName, { connection, prefix });
  await q.waitUntilReady();
  const job = await q.add('t1', { x: 1 });
  const f = await q.getJob(job.id);
  if (!f || f.data.x !== 1) {
    throw new Error('mismatch');
  }
  await q.close();
});

await test('bulk add jobs', async () => {
  const qn = queueName + '-bulk';
  const q = new Queue(qn, { connection, prefix });
  await q.waitUntilReady();
  await q.addBulk([
    { name: 'a', data: { i: 1 } },
    { name: 'b', data: { i: 2 } },
    { name: 'c', data: { i: 3 } },
  ]);
  const c = await q.getJobCounts('wait');
  if (c.wait < 3) {
    throw new Error('count=' + c.wait);
  }
  await q.close();
});

await test('pause and resume', async () => {
  const qn = queueName + '-pause';
  const q = new Queue(qn, { connection, prefix });
  await q.waitUntilReady();
  await q.pause();
  if (!(await q.isPaused())) {
    throw new Error('not paused');
  }
  await q.resume();
  if (await q.isPaused()) {
    throw new Error('still paused');
  }
  await q.close();
});

await test('get job counts by state', async () => {
  const qn = queueName + '-counts';
  const q = new Queue(qn, { connection, prefix });
  await q.waitUntilReady();
  await q.add('j1', {});
  await q.add('j2', {});
  const counts = await q.getJobCounts('wait', 'active', 'completed', 'failed');
  if (counts.wait < 2) {
    throw new Error('wait=' + counts.wait);
  }
  await q.close();
});

// --- Worker processing ---
console.log('\nWorker processing:');

await test('process job successfully', async () => {
  const qn = queueName + '-w1';
  const q = new Queue(qn, { connection, prefix });
  await q.waitUntilReady();
  const w = new Worker(qn, async (j: any) => j.data.v * 2, {
    connection,
    prefix,
  });
  await q.add('x', { v: 21 });
  const r: any = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), 10000);
    w.on('completed', (_: any, rv: any) => {
      clearTimeout(t);
      res(rv);
    });
    w.on('failed', (_: any, e: any) => {
      clearTimeout(t);
      rej(e);
    });
  });
  if (r !== 42) {
    throw new Error('got ' + r);
  }
  await w.close();
  await q.close();
});

await test('process failing job', async () => {
  const qn = queueName + '-wf';
  const q = new Queue(qn, { connection, prefix });
  await q.waitUntilReady();
  const w = new Worker(
    qn,
    async () => {
      throw new Error('boom');
    },
    { connection, prefix },
  );
  await q.add('x', {});
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), 10000);
    w.on('failed', (_: any, e: any) => {
      clearTimeout(t);
      if (e.message === 'boom') {
        res();
      } else {
        rej(new Error('wrong: ' + e.message));
      }
    });
  });
  await w.close();
  await q.close();
});

await test('process with concurrency', async () => {
  const qn = queueName + '-conc';
  const q = new Queue(qn, { connection, prefix });
  await q.waitUntilReady();
  let maxC = 0,
    cur = 0;
  const w = new Worker(
    qn,
    async () => {
      cur++;
      maxC = Math.max(maxC, cur);
      await new Promise(r => setTimeout(r, 100));
      cur--;
    },
    { connection, prefix, concurrency: 3 },
  );
  for (let i = 0; i < 6; i++) {
    await q.add('c' + i, {});
  }
  let done = 0;
  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), 15000);
    w.on('completed', () => {
      done++;
      if (done === 6) {
        clearTimeout(t);
        res();
      }
    });
  });
  if (maxC < 2) {
    throw new Error('maxConcurrent=' + maxC);
  }
  await w.close();
  await q.close();
});

// --- Delayed jobs ---
console.log('\nDelayed jobs:');

await test('process delayed job', async () => {
  const qn = queueName + '-delay';
  const q = new Queue(qn, { connection, prefix });
  await q.waitUntilReady();
  await q.add('x', { v: 99 }, { delay: 300 });
  const w = new Worker(qn, async (j: any) => j.data.v, { connection, prefix });
  const r: any = await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), 10000);
    w.on('completed', (_: any, rv: any) => {
      clearTimeout(t);
      res(rv);
    });
  });
  if (r !== 99) {
    throw new Error('got ' + r);
  }
  await w.close();
  await q.close();
});

// --- Flow ---
console.log('\nFlows:');

await test('add flow with parent and children', async () => {
  const pq = queueName + '-fp';
  const cq = queueName + '-fc';
  const q1 = new Queue(pq, { connection, prefix });
  const q2 = new Queue(cq, { connection, prefix });
  await q1.waitUntilReady();
  await q2.waitUntilReady();
  const fp = new FlowProducer({ connection, prefix });
  await fp.add({
    name: 'parent',
    queueName: pq,
    data: {},
    children: [
      { name: 'c1', queueName: cq, data: {} },
      { name: 'c2', queueName: cq, data: {} },
    ],
  });
  const cc = await q2.getJobCounts('wait', 'waiting-children');
  if ((cc.wait || 0) < 2) {
    throw new Error('children=' + JSON.stringify(cc));
  }
  await fp.close();
  await q1.close();
  await q2.close();
});

await test('process flow end-to-end', async () => {
  const pq = queueName + '-fpe';
  const cq = queueName + '-fce';
  const q1 = new Queue(pq, { connection, prefix });
  const q2 = new Queue(cq, { connection, prefix });
  await q1.waitUntilReady();
  await q2.waitUntilReady();
  const fp = new FlowProducer({ connection, prefix });

  const tree = await fp.add({
    name: 'parent',
    queueName: pq,
    data: { step: 'parent' },
    children: [{ name: 'child', queueName: cq, data: { step: 'child' } }],
  });

  // Process child
  const cw = new Worker(cq, async (j: any) => ({ childResult: j.data.step }), {
    connection,
    prefix,
  });
  // Process parent
  const pw = new Worker(pq, async (j: any) => ({ parentResult: j.data.step }), {
    connection,
    prefix,
  });

  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), 15000);
    pw.on('completed', (j: any) => {
      if (j.id === tree.job.id) {
        clearTimeout(t);
        res();
      }
    });
  });

  const parentJob = await q1.getJob(tree.job.id!);
  const state = await parentJob?.getState();
  if (state !== 'completed') {
    throw new Error('parent state=' + state);
  }

  await cw.close();
  await pw.close();
  await fp.close();
  await q1.close();
  await q2.close();
});

// --- Summary ---
console.log(`\n${'═'.repeat(50)}`);
console.log(
  `Results: ${passed} passed, ${failed} failed out of ${passed + failed}`,
);
console.log(`${'═'.repeat(50)}`);

// Cleanup
const c2 = createBunRedisClient(new RedisClient('redis://localhost:6379'));
await c2.connect();
const [, ks] = await c2.scan(0, { MATCH: prefix + ':*', COUNT: 10000 });
if (ks.length > 0) {
  await c2.del(...ks);
}
await c2.quit();
process.exit(failed > 0 ? 1 : 0);
