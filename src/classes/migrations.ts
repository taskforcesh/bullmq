import { RedisClient } from '../interfaces';

export interface MigrationOptions {
  prefix: string;
  queueName: string;
}

export type MigrationFunction = (
  client: RedisClient,
  opts: MigrationOptions,
) => Promise<void>;

export const checkPendingMigrations = async (
  client: RedisClient,
  opts: MigrationOptions,
) => {
  const migrationsKey = getRedisKeyFromOpts(opts, 'migrations');
  const existingMigrations = await client.zrange(migrationsKey, 0, -1);
  return migrations.some(
    migration =>
      !existingMigrations.includes(`${migration.version}-${migration.name}`),
  );
};

export const migrations: {
  name: string;
  version: string;
  migrate: MigrationFunction;
}[] = [
  /*
   * Example migration function
   *
  {
    name: 'migrate-paused-jobs',
    version: '6.0.0',
    migrate: async (client: RedisClient, opts: MigrationOptions) => {
      let cursor: number = 0;
      do {
        cursor = (await client.eval(
          `
        local maxCount = tonumber(ARGV[1])
        local rcall = redis.call

        local hasJobs = rcall("EXISTS", KEYS[1]) == 1

        if hasJobs then
            local jobs = rcall('LRANGE', KEYS[1], 0, maxCount - 1)
            rcall("RPUSH", KEYS[2], unpack(jobs))
            rcall("LTRIM", KEYS[1], #jobs, -1)

            if (maxCount - #jobs) <= 0 then
                return 1
            end
        end

        return 0`,
          2,
          getRedisKeyFromOpts(opts, "paused"),
          getRedisKeyFromOpts(opts, "wait"),
        )) as number;
      } while (cursor);
    },
  },
  */
];

/**
 * Run Migrations.
 *
 * This method is used to run possibly existing migrations for the queue.
 *
 * Normally, if there are pending migrations, the Queue, Worker and QueueEvents instances
 * will throw an error when they are instantiated. Use then this method to run the migrations
 * before instantiating the instances.
 *
 * @param redisClient The Redis client instance
 * @param opts The options for the migration
 *
 * @sa https://docs.bullmq.io/guide/migrations
 */
export const runMigrations = async (
  redisClient: RedisClient,
  opts: {
    prefix?: string;
    queueName: string;
  },
) => {
  const prefix = opts.prefix || 'bull';
  const migrationsKey = getRedisKeyFromOpts({ prefix, ...opts }, 'migrations');

  // The migrations key is a ZSET with the migration timestamp as the score
  for (const migration of migrations) {
    const migrationId = `${migration.version}-${migration.name}`;
    const pendingMigration = !!(await redisClient.zscore(
      migrationsKey,
      migrationId,
    ));
    if (pendingMigration) {
      continue;
    }
    console.log(`[BULLMQ] Running migration ${migrationId}`);
    try {
      await migration.migrate(redisClient, {
        prefix,
        queueName: opts.queueName,
      });
      await redisClient.zadd(migrationsKey, Date.now(), migrationId);
    } catch (err) {
      console.error(`[BULLMQ] Migration ${migrationId} failed: ${err}`);
      break;
    }
    console.log(`[BULLMQ] Migration ${migrationId} completed`);
  }
};

function getRedisKeyFromOpts(opts: MigrationOptions, key: string): string {
  return `${opts.prefix}:${opts.queueName}:${key}`;
}
