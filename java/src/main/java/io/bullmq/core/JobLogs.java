package io.bullmq.core;

/**
 * Container for job logs and count.
 */
public class JobLogs {
    private final String[] logs;
    private final long count;

    public JobLogs(String[] logs, long count) {
        this.logs = logs;
        this.count = count;
    }

    public String[] getLogs() {
        return logs.clone();
    }

    public long getCount() {
        return count;
    }
}