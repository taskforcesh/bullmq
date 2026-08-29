import { RedisMemoryServer } from 'redis-memory-server';
import EmbeddedPostgres from 'embedded-postgres';
import { ParityTestBackend } from './script';
import { runMigrations } from '../../src';
import { unlink } from 'node:fs/promises';

export async function startBackend(
  backend: ParityTestBackend,
): Promise<{ port: number; close: () => Promise<void> }> {
  if (backend === 'Redis') {
    const redisServer = await RedisMemoryServer.create();

    const port = await redisServer.getPort();
    return {
      port,
      close: async () => {
        await redisServer.stop();
      },
    };
  }

  if (backend === 'Postgres') {
    const port = Math.round(1024 + Math.random() * 64000);
    const databaseDir = `node_modules/.cache/${crypto.randomUUID()}`;
    const postgresServer = new EmbeddedPostgres({
      port,
      user: 'testuser',
      password: 'testpassword',
      databaseDir,
      persistent: false,
      // Dismiss logs from the database
      onLog() {},
    });

    await postgresServer.initialise();
    await postgresServer.start();

    await postgresServer.createDatabase('testdb');

    const client = await postgresServer.getPgClient('testdb').connect();

    await runMigrations(client);

    await client.end();

    return {
      port,
      close: async () => {
        await postgresServer.stop();
      },
    };
  }

  throw new Error(`${backend} Parity Backend not implemented`);
}
