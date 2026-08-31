import { logEvent, readDefinitons } from './utils/shared';
import { BackendFactory, QueueOptions, Worker } from '../../src';
import { setTimeout } from 'node:timers/promises';

// Only what the consumer needs to knows about the test case
export interface ParityConsumerTestCase {
  id: string;
  worker: {
    concurrency?: number;
  };
  simulation: {
    sleep?: number;
    fail?: number;
  };
}

export async function setUpWorkers(
  options: QueueOptions,
  backendFactory?: BackendFactory<any>,
) {
  const definitions = await readDefinitons<ParityConsumerTestCase>();

  for (const definition of definitions) {
    new Worker<{ test_secret: string; job_secret: string }>(
      definition.id,
      async job => {
        const {
          name: job_name,
          data: { test_secret, job_secret },
          attemptsMade,
        } = job;
        logEvent('job-started', {
          timestamp: Date.now(),
          test_id: definition.id,
          job_name,
          test_secret,
          job_secret,
        });

        if (definition.simulation.sleep) {
          await setTimeout(definition.simulation.sleep);
        }

        if (attemptsMade < (definition.simulation.fail ?? 0)) {
          throw new Error('Throw error to simulate processing failure');
        }

        logEvent('job-completed', {
          timestamp: Date.now(),
          test_id: definition.id,
          job_name,
          test_secret,
          job_secret,
        });
      },
      {
        ...options,
        concurrency: definition.worker.concurrency ?? 1,
      },
      backendFactory,
    );
  }
}
