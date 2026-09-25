package io.bullmq.core.options;

/**
 * Options for a {@link io.bullmq.core.Worker Worker}.
 */
public class WorkerOptions extends QueueBaseOptions {
    /**
     * Maximum number of jobs processed concurrently. Defaults to 1.
     */
    private int concurrency = 1;

    /**
     * Lock duration in milliseconds for a job being processed.
     */
    private int lockDuration = 30000;

    /**
     * How often (ms) to renew the lock. Defaults to half of {@code lockDuration}.
     */
    private Integer lockRenewTime;

    /**
     * Seconds the worker blocks waiting for a job before looping. Defaults to 5.
     */
    private int drainDelay = 5;

    /**
     * Optional human-readable worker name (used for observability).
     */
    private String name;

    /**
     * When true (default) the worker starts processing immediately.
     */
    private boolean autorun = true;

    /**
     * Max number of times a job can be recovered from stalled before failing. Default 1.
     */
    private int maxStalledCount = 1;

    /**
     * How often (ms) to run the stalled-job check. Default 30000.
     */
    private int stalledInterval = 30000;

    /**
     * Disable the stalled-job checker.
     */
    private boolean skipStalledCheck = false;

    /**
     * Disable periodic lock renewal.
     */
    private boolean skipLockRenewal = false;

    public int getConcurrency() {
        return concurrency;
    }

    public void setConcurrency(int concurrency) {
        this.concurrency = concurrency;
    }

    public int getLockDuration() {
        return lockDuration;
    }

    public void setLockDuration(int lockDuration) {
        this.lockDuration = lockDuration;
    }

    public Integer getLockRenewTime() {
        return lockRenewTime;
    }

    public void setLockRenewTime(Integer lockRenewTime) {
        this.lockRenewTime = lockRenewTime;
    }

    public int getDrainDelay() {
        return drainDelay;
    }

    public void setDrainDelay(int drainDelay) {
        this.drainDelay = drainDelay;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public boolean isAutorun() {
        return autorun;
    }

    public void setAutorun(boolean autorun) {
        this.autorun = autorun;
    }

    public int getMaxStalledCount() {
        return maxStalledCount;
    }

    public void setMaxStalledCount(int maxStalledCount) {
        this.maxStalledCount = maxStalledCount;
    }

    public int getStalledInterval() {
        return stalledInterval;
    }

    public void setStalledInterval(int stalledInterval) {
        this.stalledInterval = stalledInterval;
    }

    public boolean isSkipStalledCheck() {
        return skipStalledCheck;
    }

    public void setSkipStalledCheck(boolean skipStalledCheck) {
        this.skipStalledCheck = skipStalledCheck;
    }

    public boolean isSkipLockRenewal() {
        return skipLockRenewal;
    }

    public void setSkipLockRenewal(boolean skipLockRenewal) {
        this.skipLockRenewal = skipLockRenewal;
    }
}