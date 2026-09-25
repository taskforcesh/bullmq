package io.bullmq.core;

/**
 * Data returned by moveToActive operation.
 */
public class NextJobData {
    private JobJson job;
    private String jobId;
    private long rateLimitDelay;
    private long delayUntil;

    public JobJson getJob() {
        return job;
    }

    public void setJob(JobJson job) {
        this.job = job;
    }

    public String getJobId() {
        return jobId;
    }

    public void setJobId(String jobId) {
        this.jobId = jobId;
    }

    public long getRateLimitDelay() {
        return rateLimitDelay;
    }

    public void setRateLimitDelay(long rateLimitDelay) {
        this.rateLimitDelay = rateLimitDelay;
    }

    public long getDelayUntil() {
        return delayUntil;
    }

    public void setDelayUntil(long delayUntil) {
        this.delayUntil = delayUntil;
    }

    /**
     * Returns an empty NextJobData instance.
     */
    public static NextJobData empty() {
        return new NextJobData();
    }

    public boolean isEmpty() {
        return job == null && jobId == null || jobId == null;
    }
}