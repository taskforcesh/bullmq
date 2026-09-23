/**
 * Error message used when a connection is closed.
 *
 * This mirrors the constant exported by ioredis (`ioredis/built/utils`) but is
 * defined locally so that BullMQ can be used without ioredis installed (for
 * example, when using the PostgreSQL backend).
 */
export const CONNECTION_CLOSED_ERROR_MSG = 'Connection is closed.';

/**
 * Thrown by any BullMQ Redis adapter (ioredis, node-redis, Bun, …) when a
 * command fails because the connection is already closed or was closed
 * mid-flight.
 *
 * Using a single well-known class lets {@link isNotConnectionError} do a
 * structural `instanceof` check rather than fragile message-substring matching.
 */
export class ConnectionClosedError extends Error {
  constructor(
    message?: string,
    public readonly cause?: unknown,
  ) {
    super(message ?? CONNECTION_CLOSED_ERROR_MSG);
    this.name = 'ConnectionClosedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
