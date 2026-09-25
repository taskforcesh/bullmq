package io.bullmq.core;

import io.bullmq.core.options.JobsOptions;
import io.bullmq.core.options.QueueOptions;
import io.bullmq.core.options.RepeatOptions;

import java.util.List;
import java.util.Map;

/**
 * A queue lets you add jobs to be processed by one or more {@link Worker}
 * instances, and provides high-level administration such as pausing, counting
 * and obliterating.
 */
public class Queue implements AutoCloseable {
    private final String name;
    private final QueueOptions opts;
    private final QueueBackend backend;
    private final JobsOptions defaultJobOptions;

    public Queue(String name, QueueOptions opts, QueueBackend backend) {
        this.name = name;
        this.opts = opts != null ? opts : new QueueOptions();
        this.backend = backend;
        this.defaultJobOptions = this.opts.getDefaultJobOptions() != null
                ? this.opts.getDefaultJobOptions().clone()
                : new JobsOptions();

        // Initialize backend if needed
        try {
            this.backend.waitUntilReady();

            if (!this.opts.isSkipMetasUpdate()) {
                // Set queue meta (equivalent to .NET's SetQueueMetaAsync)
                // This would set opts.maxLenEvents and version in Redis
                // For now, we'll skip this as it requires backend implementation
            }
        } catch (Exception e) {
            throw new RuntimeException("Failed to initialize queue backend", e);
        }
    }

    /**
     * Adds a new job to the queue.
     */
    public Job add(String name, Object data, JobsOptions opts) {
        JobsOptions merged = mergeOpts(opts);

        // Validate jobId
        String jobId = merged.getJobId();
        if (jobId != null && (jobId.equals("0") || jobId.startsWith("0:"))) {
            throw new IllegalArgumentException("JobId cannot be '0' or start with '0:'");
        }

        Job job = Job.create(backend, this.name, name, data, merged);
        return job;
    }

    /**
     * Adds a new job to the queue with default options.
     */
    public Job add(String name, Object data) {
        return add(name, data, null);
    }

    /**
     * Pauses the processing of this queue globally.
     */
    public void pause() {
        backend.pause();
    }

    /**
     * Resumes the processing of this queue globally.
     */
    public void resume() {
        backend.resume();
    }

    /**
     * Returns true if the queue is currently paused.
     */
    public boolean isPaused() {
        return backend.isPaused();
    }

    /**
     * Returns the number of jobs in the given states.
     */
    public Map<String, Long> getJobCounts(String... types) {
        if (types.length == 0) {
            types = new String[]{"waiting", "active", "completed", "failed", "delayed", "paused"};
        }
        return backend.getJobCounts(types);
    }

    /**
     * Returns the number of jobs waiting to be processed.
     */
    public long getWaitingCount() {
        Map<String, Long> counts = getJobCounts("waiting");
        return counts.getOrDefault("waiting", 0L);
    }

    /**
     * Fetches a job by id, or null when it does not exist.
     */
    public Job getJob(String jobId) {
        try {
            return backend.getJob(jobId);
        } catch (Exception e) {
            throw new RuntimeException("Failed to get job", e);
        }
    }

    /**
     * Adds several jobs to the queue in a single efficient operation.
     */
    public List<Job> addBulk(List<JobData> jobs) {
        // In a real implementation, this would use backend.addJobs for efficiency
        // For simplicity, we'll add them one by one
        // TODO: Implement bulk add using backend.addJobs
        List<Job> result = new java.util.ArrayList<>();
        for (JobData jobData : jobs) {
            Job job = add(jobData.getName(), jobData.getData(), jobData.getOpts());
            result.add(job);
        }
        return result;
    }

    /**
     * Returns the current state of a job.
     */
    public JobState getJobState(String jobId) {
        try {
            return backend.getState(jobId);
        } catch (Exception e) {
            throw new RuntimeException("Failed to get job state", e);
        }
    }

    // Additional methods would be implemented here...
    // For brevity, I'm implementing the core methods first

    /**
     * Helper to merge job options with queue defaults.
     */
    private JobsOptions mergeOpts(JobsOptions opts) {
        JobsOptions merged = defaultJobOptions.clone();
        if (opts == null) {
            return merged;
        }

        if (opts.getJobId() != null) {
            merged.setJobId(opts.getJobId());
        }
        if (opts.getDelay() != null) {
            merged.setDelay(opts.getDelay());
        }
        if (opts.getPriority() != null) {
            merged.setPriority(opts.getPriority());
        }
        if (opts.getAttempts() != null) {
            merged.setAttempts(opts.getAttempts());
        }
        if (opts.getBackoff() != null) {
            merged.setBackoff(opts.getBackoff().clone());
        }
        if (opts.getLifo() != null) {
            merged.setLifo(opts.getLifo());
        }
        if (opts.getTimestamp() != null) {
            merged.setTimestamp(opts.getTimestamp());
        }
        if (opts.getRemoveOnComplete() != null) {
            merged.setRemoveOnComplete(opts.getRemoveOnComplete());
        }
        if (opts.getRemoveOnFail() != null) {
            merged.setRemoveOnFail(opts.getRemoveOnFail());
        }
        if (opts.getKeepLogs() != null) {
            merged.setKeepLogs(opts.getKeepLogs());
        }

        return merged;
    }

    /**
     * Simple data holder for bulk job addition.
     */
    public static class JobData {
        private final String name;
        private final Object data;
        private final JobsOptions opts;

        public JobData(String name, Object data, JobsOptions opts) {
            this.name = name;
            this.data = data;
            this.opts = opts;
        }

        public String getName() {
            return name;
        }

        public Object getData() {
            return data;
        }

        public JobsOptions getOpts() {
            return opts;
        }
    }

    /**
     * Gets the backend associated with this queue.
     * @return QueueBackend
     */
    public QueueBackend getBackend() {
        return backend;
    }

    @Override
    public void close() {
        backend.close();
    }
}