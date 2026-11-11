import {
  JobSchedulerRepeatOptions,
  Queue,
  RepeatOptions,
  RepeatStrategy,
} from '../../dist/type-tests';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
function expectType<T extends true>() {}

// `count` is managed internally and is not part of the public repeat options
expectType<Equal<'count' extends keyof RepeatOptions ? true : false, false>>();

// Strategies can read the internal iteration count
const strategy: RepeatStrategy = (millis, opts) => {
  expectType<Equal<typeof opts, JobSchedulerRepeatOptions>>();
  expectType<Equal<typeof opts.count, number | undefined>>();
  return millis + (opts.count ?? 0);
};

async function checkUpsert(queue: Queue) {
  await queue.upsertJobScheduler('id', { every: 1000 });
  // @ts-expect-error count cannot be set by users
  await queue.upsertJobScheduler('id', { every: 1000, count: 1 });
}

void strategy;
void checkUpsert;
