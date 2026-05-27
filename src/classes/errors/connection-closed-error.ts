/**
 * Thrown by any BullMQ Redis adapter (ioredis, node-redis, Bun, …) when a
 * command fails because the connection is already closed or was closed
 * mid-flight.
 *
 * Using a single well-known class lets {@link isNotConnectionError} do a
 * structural `instanceof` check rather than fragile message-substring matching.
 */
export class ConnectionClosedError extends Error {
  constructor(message?: string, public readonly cause?: unknown) {
    super(message ?? 'Connection is closed');
    this.name = 'ConnectionClosedError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
