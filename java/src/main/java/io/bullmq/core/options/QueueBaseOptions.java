package io.bullmq.core.options;

/**
 * Options shared by every high-level class.
 */
public class QueueBaseOptions {
    /**
     * Connection settings for the Redis backend (the default backend).
     */
    private ConnectionOptions connection = new ConnectionOptions();

    /**
     * Redis key prefix. Defaults to "bull".
     */
    private String prefix = "bull";

    public ConnectionOptions getConnection() {
        return connection;
    }

    public void setConnection(ConnectionOptions connection) {
        this.connection = connection;
    }

    public String getPrefix() {
        return prefix;
    }

    public void setPrefix(String prefix) {
        this.prefix = prefix;
    }
}