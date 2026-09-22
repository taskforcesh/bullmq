import { Pool } from 'pg';
import { PgPool } from '../../dist/type-tests/postgres/pg-types';
import {
  BackendFactory,
  ConnectionOptions,
  FlowProducer,
  Job,
  MinimalQueue,
  PostgresConnectionOptions,
  PostgresQueueBackend,
  Queue,
  QueueBase,
  QueueEvents,
  QueueEventsProducer,
  RedisQueueBackend,
  Worker,
  createPostgresBackend,
  createRedisBackend,
  withBackend,
} from '../../dist/type-tests';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
function expectType<T extends true>() {}

interface Data {
  value: number;
}
interface Result {
  doubled: number;
}
type Name = 'double';

const opts = { connection: 'postgres://localhost/mydb' };
const pg = withBackend(createPostgresBackend);

const queue = new pg.Queue<Data, Result, Name>('tasks', opts);
const job = queue.add('double', { value: 2 });
expectType<Equal<Awaited<typeof job>, Job<Data, Result, Name>>>();
expectType<Equal<ReturnType<typeof queue.getBackend>, PostgresQueueBackend>>();
expectType<Equal<typeof queue.opts.connection, PostgresConnectionOptions>>();
// @ts-expect-error Job data must retain its declared shape.
queue.add('double', { value: '2' });
// @ts-expect-error Job names must retain their declared union.
queue.add('other', { value: 2 });

const jobQueue = new pg.Queue<Job<Data, Result, Name>>('tasks', opts);
const inferredJob = jobQueue.add('double', { value: 2 });
expectType<Equal<Awaited<typeof inferredJob>, Job<Data, Result, Name>>>();
const dataOnlyQueue = new pg.Queue<Data>('tasks', opts);
// @ts-expect-error A single explicit job generic must not lose data checking.
dataOnlyQueue.add('double', { value: false });

const worker = new pg.Worker<Data, Result, Name>(
  'tasks',
  async job => {
    expectType<Equal<typeof job.data, Data>>();
    expectType<Equal<typeof job.name, Name>>();
    return { doubled: job.data.value * 2 };
  },
  opts,
);
worker.on('completed', (job, result) => {
  expectType<Equal<typeof result, Result>>();
  expectType<Equal<typeof job.data, Data>>();
});
expectType<Equal<ReturnType<typeof worker.getBackend>, PostgresQueueBackend>>();
new pg.Worker<Data>('tasks', undefined, opts);
new pg.Worker<Data>('tasks', '/path/to/processor.js', opts);
pg.Worker.RateLimitError();
// @ts-expect-error The processor must return the declared result.
new pg.Worker<Data, Result>('tasks', async () => 'wrong', opts);

const progressWorker = new pg.Worker<Data, Result, Name, number>(
  'tasks',
  async job => {
    await job.updateProgress(50);
    // @ts-expect-error Progress must retain the explicit progress type.
    await job.updateProgress('wrong');
    return { doubled: job.data.value * 2 };
  },
  opts,
);

const events = new pg.QueueEvents<Result>('tasks', opts);
events.on('completed', ({ returnvalue }) => {
  expectType<Equal<typeof returnvalue, Result>>();
});
expectType<Equal<ReturnType<typeof events.getBackend>, PostgresQueueBackend>>();
const flow = new pg.FlowProducer(opts);
const producer = new pg.QueueEventsProducer('tasks', opts);
expectType<Equal<ReturnType<typeof flow.getBackend>, PostgresQueueBackend>>();
expectType<
  Equal<ReturnType<typeof producer.getBackend>, PostgresQueueBackend>
>();

new pg.Queue('pool', { connection: new Pool() });
const structuralPool: PgPool = new Pool();
new pg.Queue('config', { connection: { database: 'mydb', schema: 'jobs' } });
// @ts-expect-error Invalid backend connection type.
new pg.Queue<Data>('tasks', { connection: false });
// @ts-expect-error Invalid backend connection type.
new pg.Worker<Data>('tasks', undefined, { connection: false });
// @ts-expect-error Invalid backend connection type.
new pg.QueueEvents<Result>('tasks', { connection: false });
// @ts-expect-error Invalid backend connection type.
new pg.FlowProducer({ connection: false });
// @ts-expect-error Invalid backend connection type.
new pg.QueueEventsProducer('tasks', { connection: false });
// @ts-expect-error Bound constructors require an explicit connection.
new pg.Queue<Data>('tasks');

const inferredQueue = new Queue('tasks', opts, createPostgresBackend);
const inferredWorker = new Worker(
  'tasks',
  undefined,
  opts,
  createPostgresBackend,
);
const inferredEvents = new QueueEvents('tasks', opts, createPostgresBackend);
const inferredFlow = new FlowProducer(opts, createPostgresBackend);
const inferredProducer = new QueueEventsProducer(
  'tasks',
  opts,
  createPostgresBackend,
);
expectType<
  Equal<ReturnType<typeof inferredQueue.getBackend>, PostgresQueueBackend>
>();
expectType<
  Equal<ReturnType<typeof inferredWorker.getBackend>, PostgresQueueBackend>
>();
expectType<
  Equal<ReturnType<typeof inferredEvents.getBackend>, PostgresQueueBackend>
>();
expectType<
  Equal<ReturnType<typeof inferredFlow.getBackend>, PostgresQueueBackend>
>();
expectType<
  Equal<ReturnType<typeof inferredProducer.getBackend>, PostgresQueueBackend>
>();

const minimal: MinimalQueue<PostgresConnectionOptions> = queue;
new Job(minimal, 'double', { value: 2 });
Job.create(minimal, 'double', { value: 2 });
Job.createBulk(minimal, [{ name: 'double', data: { value: 2 } }]);
Job.fromId(minimal, 'job-id');
Job.addJobLog(minimal, 'job-id', 'message');
const backendAgnostic: ConstructorParameters<typeof Job>[0] = minimal;
// @ts-expect-error Jobs do not expose the backend's connection options.
backendAgnostic.opts.connection;
// @ts-expect-error Fluent methods must not expose connection options either.
backendAgnostic.on('completed', () => {}).opts.connection;
declare const connectionlessQueue: Omit<MinimalQueue, 'opts'> & {
  opts: Record<string, never>;
};
new Job(connectionlessQueue, 'double', { value: 2 });
Job.create(connectionlessQueue, 'double', { value: 2 });
new Job(minimal, 'double', { value: 2 }).waitUntilFinished(events);

function acceptsArbitraryConnection<C>(
  value: QueueBase<PostgresQueueBackend, C>,
) {
  const minimal: MinimalQueue<C> = value;
  new Job(minimal, 'double', { value: 2 });
}

const redisOpts = { connection: { host: 'localhost', port: 6379 } };
const redisQueue = new Queue<Data, Result, Name>('tasks', redisOpts);
const redisWorker = new Worker<Data, Result, Name>(
  'tasks',
  async job => ({ doubled: job.data.value * 2 }),
  redisOpts,
);
const redisEvents = new QueueEvents<Result>('tasks', redisOpts);
const legacyMinimal: MinimalQueue = redisQueue;
expectType<Equal<typeof legacyMinimal.opts.connection, ConnectionOptions>>();
expectType<
  Equal<ReturnType<typeof redisQueue.getBackend>, RedisQueueBackend>
>();
expectType<
  Equal<ReturnType<typeof redisWorker.getBackend>, RedisQueueBackend>
>();
new Queue<Data, Result, Name, Data, Result, Name, RedisQueueBackend>(
  'tasks',
  redisOpts,
);
new Worker<Data, Result, Name, RedisQueueBackend, number>(
  'tasks',
  undefined,
  redisOpts,
);
const redis = withBackend(createRedisBackend);
new redis.Queue<Data, Result, Name>('tasks', redisOpts);

declare const customFactory: BackendFactory<
  PostgresQueueBackend,
  { endpoint: string }
>;
const custom = withBackend(customFactory);
new custom.Queue<Data>('tasks', { connection: { endpoint: 'local' } });
// @ts-expect-error Bound constructors must validate custom backend options too.
new custom.Queue<Data>('tasks', opts);
