/**
 * Resolves the PostgreSQL connection string used by the PostgreSQL backend
 * tests. Override with the `POSTGRES_URL` environment variable; otherwise a
 * localhost default is used (the test server is assumed to be already running).
 *
 * The default uses `127.0.0.1` rather than `localhost` on purpose: `localhost`
 * resolves to IPv6 `::1` first on many systems, and when the server only
 * listens on IPv4 the failed IPv6 attempt adds several milliseconds to every
 * connection — which, multiplied across the thousands of short-lived
 * connections the suite opens, is a meaningful slowdown.
 */
export function getPostgresUrl(): string {
  return (
    process.env.POSTGRES_URL ||
    'postgres://postgres:postgres@127.0.0.1:5432/bullmq_test'
  );
}
