import { RedisClient } from '../interfaces';
import { isVersionLowerThan } from '../utils';

export interface MigrationOptions {
  prefix: string;
  queueName: string;
  packageVersion?: string;
}

export type MigrationFunction = (
  client: RedisClient,
  opts: MigrationOptions,
) => Promise<void>;

export const checkPendingMigrations = async (
  client: RedisClient,
  opts: MigrationOptions,
) => {
  const metaKey = getRedisKeyFromOpts(opts, 'meta');
  const currentVersion = await client.hget(metaKey, 'version');

  // If version is not set yet, it means it's an enterily new user
  if (!currentVersion) {
    return false;
  }

  if (isVersionLowerThan(currentVersion, '6.0.0')) {
    const migrationsKey = getRedisKeyFromOpts(opts, 'migrations');
    const existingMigrations = await client.zrange(migrationsKey, 0, -1);
    return migrations.some(
      migration =>
        !existingMigrations.includes(`${migration.version}-${migration.name}`),
    );
  }

  return false;
};

const getCommandName = (commandName: string, packageVersion: string) =>
  `${commandName}:${packageVersion}`;

export const migrations: {
  name: string;
  version: string;
  migrate: MigrationFunction;
}[] = [
  {
    name: 'remove-legacy-markers',
    version: '6.0.0',
    migrate: async (client: RedisClient, opts: MigrationOptions) => {
      const keys: (string | number)[] = [
        getRedisKeyFromOpts(opts, 'wait'),
        getRedisKeyFromOpts(opts, 'paused'),
        getRedisKeyFromOpts(opts, 'meta'),
        getRedisKeyFromOpts(opts, 'completed'),
        getRedisKeyFromOpts(opts, 'failed'),
      ];
      const args = [getRedisKeyFromOpts(opts, '')];

      await (<any>client)[
        getCommandName('removeLegacyMarkers', opts.packageVersion)
      ](keys.concat(args));
    },
  },
  {
    name: 'migrate-paused-jobs',
    version: '6.0.0',
    migrate: async (client: RedisClient, opts: MigrationOptions) => {
      const keys: (string | number)[] = [
        getRedisKeyFromOpts(opts, 'paused'),
        getRedisKeyFromOpts(opts, 'wait'),
      ];
      await (<any>client)[
        getCommandName('migrateDeprecatedPausedKey', opts.packageVersion)
      ](keys);
    },
  },
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
    packageVersion: string;
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
        packageVersion: opts.packageVersion,
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
