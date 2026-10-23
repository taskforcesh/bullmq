import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  loadCommandSql,
  loadMigrationSql,
} from '../../src/postgres/sql-loader';

const SRC_ROOT = resolve(__dirname, '../../src/postgres');

describe('PostgreSQL SQL Loader', () => {
  it('loads migration SQL without throwing', () => {
    const migration = loadMigrationSql('0001_schema.sql');
    expect(typeof migration).toBe('string');
    expect(migration.length).toBeGreaterThan(0);
    expect(migration).toContain('CREATE TABLE');
  });

  it('loads command SQL without throwing', () => {
    const command = loadCommandSql('add_job');
    expect(typeof command).toBe('string');
    expect(command.length).toBeGreaterThan(0);
  });

  it('does not read from the filesystem at runtime', async () => {
    vi.resetModules();

    // The generated module inlines every statement at build time, so loading
    // SQL must not touch fs at all. This is what keeps the PostgreSQL backend
    // usable from single-file bundles (bun build --compile, esbuild --bundle,
    // pkg, Node SEA): https://github.com/taskforcesh/bullmq/issues/4603
    const readFileSync = vi.fn(() => {
      throw new Error('sql-loader must not read from disk at runtime');
    });

    vi.doMock('fs', () => ({
      readFileSync,
      default: { readFileSync },
    }));

    const { loadCommandSql: loadCommandSqlFresh } =
      await import('../../src/postgres/sql-loader');

    expect(loadCommandSqlFresh('add_job')).toBeTruthy();
    expect(readFileSync).not.toHaveBeenCalled();

    vi.doUnmock('fs');
  });

  it('inlined SQL is in sync with the .sql sources', () => {
    // Guards against editing a .sql file without regenerating
    // src/postgres/sql-scripts.ts (yarn generate:sql:scripts).
    expect(loadCommandSql('add_job')).toBe(
      readFileSync(resolve(SRC_ROOT, 'commands/add_job.sql'), 'utf8'),
    );
    expect(loadMigrationSql('0001_schema.sql')).toBe(
      readFileSync(resolve(SRC_ROOT, 'migrations/0001_schema.sql'), 'utf8'),
    );
  });

  it('throws a descriptive error for unknown keys', () => {
    expect(() => loadCommandSql('no_such_command')).toThrow(
      "Could not find command SQL for 'no_such_command'",
    );
    expect(() => loadMigrationSql('9999_missing.sql')).toThrow(
      "Could not find migration SQL for '9999_missing.sql'",
    );
  });
});
