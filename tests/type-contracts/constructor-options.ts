import {
  BackendFactory,
  ConnectionOptions,
  FlowProducer,
  IQueueBackend,
  Job,
  JobScheduler,
  Queue,
  QueueBase,
  QueueEvents,
  QueueEventsProducer,
  QueueGetters,
  RedisQueueBackend,
  Worker,
  createPostgresBackend,
  withBackend,
} from '../../dist/type-tests';

interface CustomConnection {
  endpoint: string;
}
interface CustomBackend extends IQueueBackend {
  customOperation(): void;
}
declare const factory: BackendFactory<CustomBackend, CustomConnection>;
const opts = { connection: { endpoint: 'localhost' } };

new QueueBase('tasks');
new QueueGetters('tasks');
new Queue('tasks');
new Queue<{ value: number }>('tasks');
new QueueEvents('tasks');
new QueueEvents<number>('tasks');
new QueueEventsProducer('tasks');
new FlowProducer();
new Queue('tasks', undefined);
new QueueBase('tasks', undefined, undefined, true);

const queue = new Queue('tasks', opts, factory);
queue.opts.connection.endpoint.toUpperCase();
queue.getBackend().customOperation();
new QueueBase('tasks', opts, factory);
new QueueGetters('tasks', opts, factory);
new QueueEvents('tasks', opts, factory);
new QueueEventsProducer('tasks', opts, factory);
new FlowProducer(opts, factory);
new Worker('tasks', undefined, opts, factory);
new JobScheduler('tasks', opts, factory);

// @ts-expect-error An explicit factory requires connection options.
new QueueBase('tasks', undefined, factory);
// @ts-expect-error Inherited constructors must require options too.
new QueueGetters('tasks', undefined, factory);
// @ts-expect-error An explicit factory requires connection options.
new Queue('tasks', undefined, factory);
// @ts-expect-error An explicit factory requires connection options.
new QueueEvents('tasks', undefined, factory);
// @ts-expect-error An explicit factory requires connection options.
new QueueEventsProducer('tasks', undefined, factory);
// @ts-expect-error An explicit factory requires connection options.
new FlowProducer(undefined, factory);
// @ts-expect-error An explicit factory requires connection options.
new Worker('tasks', undefined, undefined, factory);
// @ts-expect-error Schedulers require connection options.
new JobScheduler('tasks', undefined, factory);

// @ts-expect-error A missing connection cannot satisfy the factory.
new Queue('tasks', {}, factory);
// @ts-expect-error A missing endpoint cannot satisfy the factory.
new Queue('tasks', { connection: {} }, factory);
// @ts-expect-error Null options cannot select the default overload.
new Queue('tasks', null, factory);
// @ts-expect-error Undefined connections cannot select the default overload.
new Queue('tasks', { connection: undefined }, factory);
// @ts-expect-error PostgreSQL also requires explicit connection options.
new Queue('tasks', undefined, createPostgresBackend);

// @ts-expect-error Explicit backend/connection types cannot use Redis defaults.
new QueueBase<CustomBackend, CustomConnection>('tasks');
// @ts-expect-error Explicit backend/connection types cannot use Redis defaults.
new QueueGetters<Job, CustomBackend, CustomConnection>('tasks');
// @ts-expect-error Explicit backend/connection types cannot use Redis defaults.
new Queue<
  unknown,
  unknown,
  string,
  unknown,
  unknown,
  string,
  CustomBackend,
  CustomConnection
>('tasks');
// @ts-expect-error Explicit backend/connection types cannot use Redis defaults.
new QueueEvents<number, CustomBackend, CustomConnection>('tasks');
// @ts-expect-error Explicit backend/connection types cannot use Redis defaults.
new QueueEventsProducer<CustomBackend, CustomConnection>('tasks');
// @ts-expect-error Explicit backend/connection types cannot use Redis defaults.
new FlowProducer<CustomBackend, CustomConnection>();
// @ts-expect-error Explicit backend/connection types cannot omit worker options.
new Worker<unknown, unknown, string, CustomBackend, number, CustomConnection>(
  'tasks',
);
// @ts-expect-error A custom backend alone cannot use the default overload.
new FlowProducer<CustomBackend>();
// @ts-expect-error A custom connection alone cannot use the default overload.
new FlowProducer<RedisQueueBackend, CustomConnection>();
// @ts-expect-error A narrower Redis connection may still have required fields.
new FlowProducer<RedisQueueBackend, ConnectionOptions & { host: string }>();

const bound = withBackend(factory);
new bound.Queue<{ value: number }>('tasks', opts);
// @ts-expect-error Bound constructors must also reject undefined options.
new bound.Queue('tasks', undefined);
// @ts-expect-error Bound constructors must also reject undefined options.
new bound.Worker('tasks', undefined, undefined);
// @ts-expect-error Bound constructors must also reject undefined options.
new bound.QueueEvents('tasks', undefined);
// @ts-expect-error Bound constructors must also reject undefined options.
new bound.QueueEventsProducer('tasks', undefined);
// @ts-expect-error Bound constructors must also reject undefined options.
new bound.FlowProducer(undefined);

class TypedQueue extends Queue<
  unknown,
  unknown,
  string,
  unknown,
  unknown,
  string,
  CustomBackend,
  CustomConnection
> {
  constructor() {
    super('tasks', opts, factory);
  }
}
