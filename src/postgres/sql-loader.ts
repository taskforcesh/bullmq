import { SQL_COMMANDS, SQL_MIGRATIONS } from './sql-scripts';

/**
 * Loads a migration's SQL — the portable source of truth shared with the
 * Elixir/Python ports. Results are cached after the first lookup.
 *
 * The SQL is inlined into the published JavaScript at build time (see
 * scripts/generateSqlScripts.js), exactly like the Redis backend's `.lua`
 * scripts, so no filesystem access is needed at runtime. This keeps the
 * PostgreSQL backend usable from single-file bundles (bun build --compile,
 * esbuild --bundle, pkg, Node SEA, deno compile) where the `.sql` files are
 * not shipped alongside the code:
 *
 * @see https://github.com/taskforcesh/bullmq/issues/4603
 *
 * @param file - Migration filename, e.g. `0001_schema.sql`.
 */
const migrationCache = new Map<string, string>();
const commandCache = new Map<string, string>();

export function loadMigrationSql(file: string): string {
  let sql = migrationCache.get(file);
  if (sql === undefined) {
    sql = SQL_MIGRATIONS[file];
    if (sql === undefined) {
      throw new Error(`Could not find migration SQL for '${file}'`);
    }
    migrationCache.set(file, sql);
  }
  return sql;
}

/**
 * Loads a runtime command's SQL by name (without the `.sql` extension), cached
 * after the first lookup. Runtime queries contain NO schema/namespace
 * references — the connection's `search_path` selects the schema — so they are
 * portable verbatim to the Python/Elixir/PHP/Rust ports (mirroring how the
 * Redis backend's `.lua` scripts never hardcode the key prefix).
 *
 * @param name - Command name, e.g. `add_job`.
 */
export function loadCommandSql(name: string): string {
  let sql = commandCache.get(name);
  if (sql === undefined) {
    sql = SQL_COMMANDS[`${name}.sql`];
    if (sql === undefined) {
      throw new Error(`Could not find command SQL for '${name}'`);
    }
    commandCache.set(name, sql);
  }
  return sql;
}
