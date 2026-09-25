package io.bullmq.core.options;

import io.lettuce.core.ClientOptions;
import io.lettuce.core.RedisClient;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.resource.ClientResources;

/**
 * How to connect to Redis. Provide either a connection string / configuration,
 * or an already-connected RedisClient to share it across queues and workers.
 */
public class ConnectionOptions {
    private String connectionString = "redis://localhost:6379";
    private String password;
    private int database = 0;
    private int timeout = 2000;

    public ConnectionOptions() {
    }

    public ConnectionOptions(String connectionString) {
        this.connectionString = connectionString;
    }

    public String getConnectionString() {
        return connectionString;
    }

    public void setConnectionString(String connectionString) {
        this.connectionString = connectionString;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
    }

    public int getDatabase() {
        return database;
    }

    public void setDatabase(int database) {
        this.database = database;
    }

    public int getTimeout() {
        return timeout;
    }

    public void setTimeout(int timeout) {
        this.timeout = timeout;
    }

    /**
     * Creates a ConnectionOptions from a connection string.
     */
    public static ConnectionOptions fromString(String connectionString) {
        return new ConnectionOptions(connectionString);
    }

    /**
     * Creates a Lettuce RedisClient from these options.
     */
    public RedisClient createRedisClient() {
        if (connectionString != null && !connectionString.isEmpty()) {
            return RedisClient.create(connectionString);
        }
        // Fallback to default client if needed
        return RedisClient.create();
    }

    /**
     * Gets the ClientOptions multiplexer (for compatibility).
     * @return ClientOptions
     */
    public io.lettuce.core.ClientOptions getMultiplexer() {
        // Return default ClientOptions for now
        return io.lettuce.core.ClientOptions.create();
    }

    /**
     * Gets the prefix for Redis keys.
     * @return prefix string
     */
    public String getPrefix() {
        // Default prefix, can be overridden if needed
        return "";
    }
}