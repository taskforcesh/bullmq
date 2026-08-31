import { RedisMemoryServer } from 'redis-memory-server';
import EmbeddedPostgres from 'embedded-postgres';
import { ParityTestBackend } from './script';
import { runMigrations } from '../../src';

export async function startBackend(
  backend: ParityTestBackend,
  signal: AbortSignal,
): Promise<number> {
  if (backend === 'Redis') {
    const redisServer = await RedisMemoryServer.create();

    const port = await redisServer.getPort();

    signal.addEventListener('abort', () => {
      redisServer.stop();
    });
    return port;
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

    signal.addEventListener('abort', () => {
      postgresServer.stop();
    });

    return port;
  }

  throw new Error(`${backend} Parity Backend not implemented`);
}
