import { logEvent, readDefinitons } from './utils/shared';
import { BackendFactory, Queue, QueueOptions } from '../../src';

// Only what the producer needs to know about the test case
export interface ParityProducerTestCase {
  id: string;
  job: {
    count: number;
    delay?: number;
  };
}

export async function produceEvents(
  options: QueueOptions,
  backendFactory?: BackendFactory,
) {
  const definitions = await readDefinitons<ParityProducerTestCase>();

  for (const definition of definitions) {
    const queue = new Queue(definition.id, options, backendFactory);
    const test_secret = crypto.randomUUID();

    for (let i = 0; i < definition.job.count; i++) {
      const job_name = `job-${i}`;
      const job_secret = crypto.randomUUID();
      await queue.add(
        job_name,
        { test_secret, job_secret },
        { delay: definition.job.delay },
      );

      logEvent('job-created', {
        timestamp: Date.now(),
        test_id: definition.id,
        job_name,
        test_secret,
        job_secret,
      });
    }

    await queue.close();
  }
}
