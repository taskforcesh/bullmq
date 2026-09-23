import { describe, expect, it } from 'vitest';
import { randomUUID } from '../src/utils';
import { createRedisBackend } from '../src/utils/create-backend';
import { createTestConnection } from './utils/connection-factory';

describe('Redis backend connection ownership', () => {
  it.each([
    { blocking: false, force: false },
    { blocking: false, force: true },
    { blocking: true, force: false },
    { blocking: true, force: true },
  ])(
    'closes only owned clients (blocking: $blocking, force: $force)',
    async ({ blocking, force }) => {
      const connection = createTestConnection();
      const opts = {
        connection,
        prefix: process.env.BULLMQ_TEST_PREFIX || 'bull',
      };
      const backend = createRedisBackend(`test-${randomUUID()}`, opts, {
        blocking,
      });
      try {
        await backend.waitUntilReady();
        const client = await backend.connection.client;
        if (blocking) {
          expect(client).not.toBe(connection);
        } else {
          expect(client).toBe(connection);
        }

        await backend.close(force);

        expect(client.status).toBe(blocking ? 'end' : 'ready');
        expect(await connection.info()).toContain('redis_version');
      } finally {
        if (blocking) {
          await backend.disconnect();
        }
        await backend.close(true);
        await connection.quit();
      }
    },
  );
});
