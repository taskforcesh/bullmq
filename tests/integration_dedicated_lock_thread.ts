import { Queue, Worker } from '../src/classes';
import { delay } from '../src/utils';
import { default as IORedis } from 'ioredis';

async function testBasicFunctionality() {
  const connection = new IORedis('localhost', { maxRetriesPerRequest: null });
  const queue = new Queue('test-dedicated-lock', { connection });

  console.log('Creating worker with dedicated lock thread...');

  const worker = new Worker(
    'test-dedicated-lock',
    async job => {
      console.log(`Processing job ${job.id}`);
      await delay(2000); // 2 second job
      return { success: true };
    },
    {
      connection,
      useDedicatedLockThread: true,
      lockDuration: 1000,
      lockRenewTime: 500,
    },
  );

  worker.on('completed', (job, result) => {
    console.log(`Job ${job.id} completed:`, result);
  });

  worker.on('error', error => {
    console.error('Worker error:', error);
  });

  await worker.waitUntilReady();
  console.log('Worker ready, adding job...');

  const job = await queue.add('test-job', { data: 'test' });
  console.log(`Added job ${job.id}`);

  // Wait for completion
  await delay(5000);

  await worker.close();
  await queue.close();
  await connection.quit();

  console.log('Test completed successfully!');
}

if (require.main === module) {
  testBasicFunctionality().catch(console.error);
}

export { testBasicFunctionality };
