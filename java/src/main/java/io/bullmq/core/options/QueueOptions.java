package io.bullmq.core.options;

/**
 * Options for a {@link io.bullmq.core.Queue Queue}.
 */
public class QueueOptions extends QueueBaseOptions {
    /**
     * Default options merged into every job added to this queue.
     */
    private JobsOptions defaultJobOptions;

    /**
     * When true, the queue meta hash is not written on startup.
     */
    private boolean skipMetasUpdate = false;

    public JobsOptions getDefaultJobOptions() {
        return defaultJobOptions;
    }

    public void setDefaultJobOptions(JobsOptions defaultJobOptions) {
        this.defaultJobOptions = defaultJobOptions;
    }

    public boolean isSkipMetasUpdate() {
        return skipMetasUpdate;
    }

    public void setSkipMetasUpdate(boolean skipMetasUpdate) {
        this.skipMetasUpdate = skipMetasUpdate;
    }
}