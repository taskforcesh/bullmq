/**
 * Resolves the PostgreSQL connection string used by the PostgreSQL backend
 * tests. Override with the `POSTGRES_URL` environment variable; otherwise a
 * localhost default is used (the test server is assumed to be already running).
 */
export function getPostgresUrl(): string {
  return (
    process.env.POSTGRES_URL ||
    'postgres://postgres:postgres@localhost:5432/bullmq_test'
  );
}
