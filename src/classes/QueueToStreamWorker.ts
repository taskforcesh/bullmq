import { Worker } from './worker';
import { WorkerOptions } from '../interfaces';
import { RedisConnection } from './redis-connection';
import { Job } from './job';
import { StreamProducer } from './stream-producer';

export class QueueToStreamWorker extends Worker {
  constructor(
    name: string,
    streamName: string,
    opts?: WorkerOptions,
    Connection?: typeof RedisConnection,
  ) {
    const producer = new StreamProducer(
      streamName,
      { connection: undefined },
      Connection,
    );
    const processor = async (job: Job) => {
      await producer.produce(job.data);
    };
    super(name, processor, opts, Connection);
  }
}
