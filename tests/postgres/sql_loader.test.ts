import { describe, expect, it, vi } from 'vitest';
import {
  loadCommandSql,
  loadMigrationSql,
} from '../../src/postgres/sql-loader';

describe('PostgreSQL SQL Loader', () => {
  it('loads migration SQL files without throwing', () => {
    const migration = loadMigrationSql('0001_schema.sql');
    expect(typeof migration).toBe('string');
    expect(migration.length).toBeGreaterThan(0);
    expect(migration).toContain('CREATE TABLE');
  });

  it('loads command SQL files without throwing', () => {
    const command = loadCommandSql('add_job');
    expect(typeof command).toBe('string');
    expect(command.length).toBeGreaterThan(0);
  });

  it('caches loaded SQL content for subsequent calls', async () => {
    vi.resetModules();
    const fs = await import('fs');
    const readSpy = vi.spyOn(fs, 'readFileSync');

    const { loadCommandSql: loadCommandSqlFresh } = await import(
      '../../src/postgres/sql-loader',
    );

    loadCommandSqlFresh('add_job');
    loadCommandSqlFresh('add_job');

    expect(readSpy).toHaveBeenCalledTimes(1);
    readSpy.mockRestore();
  });
});
