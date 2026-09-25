package io.bullmq.core.options;

/**
 * Options for a {@link io.bullmq.core.events.QueueEvents QueueEvents} listener.
 */
public class QueueEventsOptions extends QueueBaseOptions {
    /**
     * When true (default) the listener starts consuming events immediately.
     */
    private boolean autorun = true;

    /**
     * Cursor to start from. Defaults to <c>"$"</c> (only events produced after
     * the listener starts). Provide a known event id to resume from it.
     */
    private String lastEventId;

    /**
     * Timeout in milliseconds for each blocking read of the event stream. Default 10000.
     */
    private int blockingTimeout = 10000;

    public boolean isAutorun() {
        return autorun;
    }

    public void setAutorun(boolean autorun) {
        this.autorun = autorun;
    }

    public String getLastEventId() {
        return lastEventId;
    }

    public void setLastEventId(String lastEventId) {
        this.lastEventId = lastEventId;
    }

    public int getBlockingTimeout() {
        return blockingTimeout;
    }

    public void setBlockingTimeout(int blockingTimeout) {
        this.blockingTimeout = blockingTimeout;
    }
}