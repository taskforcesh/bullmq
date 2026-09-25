package io.bullmq.core.options;

/**
 * Options that control how a single job is added and processed.
 */
public class JobsOptions {
    /**
     * Optional explicit job id. Cannot be "0" or start with "0:".
     */
    private String jobId;

    /**
     * Delay in milliseconds before the job becomes available.
     */
    private Long delay;

    /**
     * Job priority (1 = highest). 0 (or null) means no priority.
     */
    private Integer priority;

    /**
     * Number of total attempts to run the job until it completes.
     */
    private Integer attempts;

    /**
     * Backoff setting for automatic retries.
     */
    private BackoffOptions backoff;

    /**
     * When true the job is added to the right of the wait list (LIFO).
     */
    private Boolean lifo;

    /**
     * Creation timestamp (ms since epoch). Defaults to now.
     */
    private Long timestamp;

    /**
     * Remove the job when it completes: true to remove, a number to keep
     * that many, or a KeepJobs policy.
     */
    private Object removeOnComplete;

    /**
     * Remove the job when it fails. Same shape as removeOnComplete.
     */
    private Object removeOnFail;

    /**
     * Maximum number of log entries to keep for the job (0 = unlimited).
     */
    private Integer keepLogs;

    public String getJobId() {
        return jobId;
    }

    public void setJobId(String jobId) {
        this.jobId = jobId;
    }

    public Long getDelay() {
        return delay;
    }

    public void setDelay(Long delay) {
        this.delay = delay;
    }

    public Integer getPriority() {
        return priority;
    }

    public void setPriority(Integer priority) {
        this.priority = priority;
    }

    public Integer getAttempts() {
        return attempts;
    }

    public void setAttempts(Integer attempts) {
        this.attempts = attempts;
    }

    public BackoffOptions getBackoff() {
        return backoff;
    }

    public void setBackoff(BackoffOptions backoff) {
        this.backoff = backoff;
    }

    public Boolean getLifo() {
        return lifo;
    }

    public void setLifo(Boolean lifo) {
        this.lifo = lifo;
    }

    public Long getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(Long timestamp) {
        this.timestamp = timestamp;
    }

    public Object getRemoveOnComplete() {
        return removeOnComplete;
    }

    public void setRemoveOnComplete(Object removeOnComplete) {
        this.removeOnComplete = removeOnComplete;
    }

    public Object getRemoveOnFail() {
        return removeOnFail;
    }

    public void setRemoveOnFail(Object removeOnFail) {
        this.removeOnFail = removeOnFail;
    }

    public Integer getKeepLogs() {
        return keepLogs;
    }

    public void setKeepLogs(Integer keepLogs) {
        this.keepLogs = keepLogs;
    }

    /**
     * Creates a shallow copy of these options.
     */
    public JobsOptions clone() {
        JobsOptions clone = new JobsOptions();
        clone.jobId = this.jobId;
        clone.delay = this.delay;
        clone.priority = this.priority;
        clone.attempts = this.attempts;
        clone.backoff = this.backoff != null ? this.backoff.clone() : null;
        clone.lifo = this.lifo;
        clone.timestamp = this.timestamp;
        clone.removeOnComplete = this.removeOnComplete;
        clone.removeOnFail = this.removeOnFail;
        clone.keepLogs = this.keepLogs;
        return clone;
    }
}