import { describe, expect, it } from 'vitest';
import { loadCommandSql, loadMigrationSql } from '../../src/postgres/sql-loader';

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

  it('caches loaded SQL content for subsequent calls', () => {
    const firstCall = loadCommandSql('add_job');
    const secondCall = loadCommandSql('add_job');
    expect(firstCall).toBe(secondCall);
  });
});
