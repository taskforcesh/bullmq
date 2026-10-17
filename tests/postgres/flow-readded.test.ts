import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { createPostgresBackend, withBackend } from '../../src';
import { checkReaddedFlow } from '../utils/readded-flow';
import { getPostgresUrl } from './utils/postgres-url';

describe('PostgreSQL re-added flows', () => {
  it.each([
    [true, false, 'siblings'],
    [false, false, 'siblings'],
    [true, true, 'siblings'],
    [false, true, 'siblings'],
    [true, false, 'nested'],
    [true, true, 'split'],
  ] as const)(
    'registers every sibling before releasing a parent (completedFirst=%s, bulk=%s, structure=%s)',
    async (completedFirst, bulk, structure) => {
      const schema = `flow_${randomUUID().replace(/-/g, '')}`;
      const connection = {
        connectionString: getPostgresUrl(),
        schema,
        migrate: true,
      };
      const { Queue, FlowProducer, Worker } = withBackend(
        createPostgresBackend,
      );
      const queue = new Queue('readded', { connection });
      await queue.waitUntilReady();
      const flow = new FlowProducer({ connection });
      const worker = new Worker('readded', undefined, {
        connection,
        autorun: false,
      });
      const errors: Error[] = [];
      worker.on('error', error => errors.push(error));
      try {
        await checkReaddedFlow(
          queue,
          flow,
          worker,
          completedFirst,
          bulk,
          structure,
        );
        expect(errors).toEqual([]);
      } finally {
        await worker.close();
        await flow.close();
        await queue.close();
        const pool = new Pool({ connectionString: getPostgresUrl() });
        try {
          await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
        } finally {
          await pool.end();
        }
      }
    },
  );
});
