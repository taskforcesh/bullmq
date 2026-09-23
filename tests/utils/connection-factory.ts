import type { IRedisClient } from '../../src/interfaces/redis-client';

export interface ConnectionFactoryOpts {
  host?: string;
  port?: number;
  connectionName?: string;
}

export type ConnectionFactory = (opts?: ConnectionFactoryOpts) => IRedisClient;

let _factory: ConnectionFactory | undefined;

export function setConnectionFactory(factory: ConnectionFactory): void {
  _factory = factory;
}

export function getConnectionFactory(): ConnectionFactory {
  if (!_factory) {
    throw new Error(
      'Test connection factory not set. Ensure vitest setup has called setConnectionFactory().',
    );
  }
  return _factory;
}

/**
 * Create a test connection using the configured factory.
 * The factory is set by the vitest setup file for each adapter.
 */
export function createTestConnection(
  opts?: ConnectionFactoryOpts,
): IRedisClient {
  return getConnectionFactory()(opts);
}
