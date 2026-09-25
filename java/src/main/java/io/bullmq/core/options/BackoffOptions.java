package io.bullmq.core.options;

/**
 * Backoff configuration for retrying failed jobs.
 */
public class BackoffOptions implements Cloneable {
    /**
     * Strategy type (e.g. "fixed", "exponential").
     */
    private String type = "fixed";

    /**
     * Base delay in milliseconds.
     */
    private long delay;

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public long getDelay() {
        return delay;
    }

    public void setDelay(long delay) {
        this.delay = delay;
    }

    @Override
    public BackoffOptions clone() {
        try {
            return (BackoffOptions) super.clone();
        } catch (CloneNotSupportedException e) {
            throw new AssertionError();
        }
    }
}