package io.bullmq.core;

import io.bullmq.core.options.JobsOptions;
import io.bullmq.core.options.RepeatOptions;

import java.util.List;
import java.util.Map;

/**
 * Backend interface for queue operations. This defines the contract that
 * RedisBackend (and potentially other backends) must implement.
 */
public interface QueueBackend {
    /**
     * The queue name this backend operates on.
     */
    String getName();

    /**
     * The key prefix.
     */
    String getPrefix();

    /**
     * Waits until the backend's connection is ready.
     */
    void waitUntilReady();

    /**
     * Adds a job to the queue and returns its ID.
     */
    String addJob(Job job);

    /**
     * Adds multiple jobs to the queue in a single efficient operation.
     */
    List<String> addJobs(List<Job> jobs);

    /**
     * Returns the current state of a job.
     */
    JobState getState(String jobId) throws Exception;

    /**
     * Fetches a job by ID, or null when it does not exist.
     */
    Job getJob(String jobId);

    /**
     * Returns the number of jobs in the given states.
     */
    Map<String, Long> getJobCounts(String... types);

    /**
     * Pauses the processing of this queue globally.
     */
    void pause();

    /**
     * Resumes the processing of this queue globally.
     */
    void resume();

    /**
     * Returns true if the queue is currently paused.
     */
    boolean isPaused();

    /**
     * Returns waiting jobs.
     */
    List<Job> getWaiting(int start, int end);

    /**
     * Returns active jobs.
     */
    List<Job> getActive(int start, int end);

    /**
     * Returns completed jobs.
     */
    List<Job> getCompleted(int start, int end);

    /**
     * Returns failed jobs.
     */
    List<Job> getFailed(int start, int end);

    /**
     * Returns delayed jobs.
     */
    List<Job> getDelayed(int start, int end);

    /**
     * Removes the given job (and optionally its children).
     */
    long remove(String jobId, boolean removeChildren);

    /**
     * Closes the backend and its connection.
     */
    void close();

    /**
     * Moves a job to active state (called by worker when processing starts).
     */
    NextJobData moveToActive(String token, String workerName);

    /**
     * Moves a job to completed state.
     */
    MoveToFinishedResult moveToCompleted(Job job, String returnValueJson, Object removeOnComplete, String token, boolean fetchNext);

    /**
     * Moves a job to failed state.
     */
    MoveToFinishedResult moveToFailed(Job job, String failedReason, Object removeOnFail, String token, boolean fetchNext, String stackTraceJson);

    /**
     * Updates job progress.
     */
    void updateProgress(String jobId, Object progress);

    /**
     * Updates job data.
     */
    void updateData(String jobId, Object data);

    /**
     * Changes job priority.
     */
    void changePriority(String jobId, int priority, boolean lifo);

    /**
     * Promotes a delayed job so it can be processed as soon as possible.
     */
    void promote(String jobId);

    /**
     * Adds log entry to job.
     */
    long addLog(String jobId, String logRow, int keepLogs);

    /**
     * Gets job logs.
     */
    JobLogs getJobLogs(String jobId, int start, int end, boolean asc);

    /**
     * Gets processed children values.
     */
    Map<String, String> getProcessedChildrenValues(String jobId);

    /**
     * Rate limit TTL.
     */
    long getRateLimitTtl();

    /**
     * Gets ranges
     */
    List<String> getRanges(List<String> types, int start, int end, boolean asc);

    /**
     * Clean jobs in set
     */
    List<String> cleanJobsInSet(String set, long grace, int limit);

    /**
     * Obliterate queue
     */
    long obliterate(boolean force, int count);

    /**
     * Extend lock
     */
    long extendLock(String jobId, String token, int duration);

    /**
     * Extend locks
     */
    List<String> extendLocks(List<String> jobIds, List<String> tokens, int duration);

    /**
     * Get counts
     */
    long[] getCounts(String... types);

    /**
     * Get counts per priority
     */
    long[] getCountsPerPriority(long... priorities);

    /**
     * Job scheduler operations
     */
    String addJobScheduler(String schedulerId, Long nextMillis, String templateData,
                           Map<String, Object> templateOpts, Map<String, Object> schedulerOpts,
                           Map<String, Object> delayedJobOpts, String producerId);

    String updateJobSchedulerNextMillis(String schedulerId, long nextMillis,
                                        String templateData, Map<String, Object> delayedJobOpts,
                                        String producerId);

    long removeJobScheduler(String schedulerId);

    Map<String, String> getJobScheduler(String id);

    boolean isJobScheduler(String id);

    Map<String, String> getJobSchedulerData(String key);

    List<String> getJobSchedulersRange(int start, int end, boolean asc);

    long getJobSchedulersCount();

    /**
     * Worker blocking primitive - waits for a job to be available.
     */
    MarkerResult waitForJob(double blockTimeoutSeconds);

    /**
     * Event stream operations
     */
    String publishEvent(List<String> fields, int maxEvents);

    List<EventEntry> readEvents(String id, double blockTimeoutSeconds);

    /**
     * Moves stalled jobs from active to waiting state.
     *
     * @param count Maximum number of stalled jobs to move
     * @param interval The interval to check for stalled jobs
     * @return List of job IDs that were moved
     */
    List<String> moveStalledJobsToWaitAsync(int count, int interval);

    /**
     * Internal helper to get the current timestamp in milliseconds.
     */
    static long now() {
        return System.currentTimeMillis();
    }

    /**
     * Pauses or resumes the queue based on the pause flag.
     *
     * @param pause true to pause, false to resume
     */
    default void pause(boolean pause) {
        if (pause) {
            pause();
        } else {
            resume();
        }
    }

    /**
     * Drains the queue, moving jobs between wait and delayed/paused lists.
     *
     * @param delayed if true, moves delayed jobs to wait; if false, moves wait jobs to paused
     */
    default void drain(boolean delayed) {
        // Default implementation - can be overridden by backends that need special handling
        throw new UnsupportedOperationException("drain(boolean) not implemented");
    }
}