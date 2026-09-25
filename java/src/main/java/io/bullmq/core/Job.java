package io.bullmq.core;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.bullmq.core.options.JobsOptions;
import io.bullmq.core.options.RepeatOptions;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * Represents a job in the queue. Jobs are normally created implicitly when you
 * add work to a {@link Queue} (e.g. {@link Queue#add(String, Object, JobsOptions)})
 * and an instance is handed to the worker's processor function.
 */
public class Job {
    private final QueueBackend backend;
    private final String queueName;
    private String id;
    private final String name;
    private Object data;
    private final JobsOptions opts;
    private long timestamp;
    private long delay;
    private int priority;
    private int attempts;
    private int attemptsMade;
    private int attemptsStarted;
    private int stalledCounter;
    private Object progress;
    private Object returnValue;
    private String failedReason;
    private final List<String> stackTrace = new ArrayList<>();
    private Long finishedOn;
    private Long processedOn;
    private String parentKey;
    private Object parent;
    private String repeatJobKey;
    private RepeatOptions repeat;
    private String deduplicationId;
    private String deferredFailure;
    private String token;

    private static final ObjectMapper objectMapper = new ObjectMapper();

    protected Job(QueueBackend backend, String queueName, String name, Object data, JobsOptions opts) {
        this.backend = backend;
        this.queueName = queueName;
        this.name = name;
        this.data = data;
        this.opts = opts;
        this.id = opts.getJobId();
        this.timestamp = opts.getTimestamp() != null ? opts.getTimestamp() : System.currentTimeMillis();
        this.delay = opts.getDelay() != null ? opts.getDelay() : 0L;
        this.priority = opts.getPriority() != null ? opts.getPriority() : 0;
        this.attempts = opts.getAttempts() != null ? opts.getAttempts() : 0;
    }

    /**
     * Creates a job and adds it to the queue via the backend.
     */
    public static Job create(QueueBackend backend, String queueName, String name, Object data, JobsOptions opts) {
        Job job = new Job(backend, queueName, name, data, opts);
        String jobId = backend.addJob(job);
        job.setId(jobId);
        return job;
    }

    public QueueBackend getBackend() {
        return backend;
    }

    public String getQueueName() {
        return queueName;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public Object getData() {
        return data;
    }

    public void setData(Object data) {
        this.data = data;
    }

    public JobsOptions getOpts() {
        return opts;
    }

    public long getTimestamp() {
        return timestamp;
    }

    public void setTimestamp(long timestamp) {
        this.timestamp = timestamp;
    }

    public long getDelay() {
        return delay;
    }

    public void setDelay(long delay) {
        this.delay = delay;
    }

    public int getPriority() {
        return priority;
    }

    public void setPriority(int priority) {
        this.priority = priority;
    }

    public int getAttempts() {
        return attempts;
    }

    public void setAttempts(int attempts) {
        this.attempts = attempts;
    }

    public int getAttemptsMade() {
        return attemptsMade;
    }

    public void setAttemptsMade(int attemptsMade) {
        this.attemptsMade = attemptsMade;
    }

    public int getAttemptsStarted() {
        return attemptsStarted;
    }

    public void setAttemptsStarted(int attemptsStarted) {
        this.attemptsStarted = attemptsStarted;
    }

    public int getStalledCounter() {
        return stalledCounter;
    }

    public void setStalledCounter(int stalledCounter) {
        this.stalledCounter = stalledCounter;
    }

    public Object getProgress() {
        return progress;
    }

    public void setProgress(Object progress) {
        this.progress = progress;
    }

    public Object getReturnValue() {
        return returnValue;
    }

    public void setReturnValue(Object returnValue) {
        this.returnValue = returnValue;
    }

    public String getFailedReason() {
        return failedReason;
    }

    public void setFailedReason(String failedReason) {
        this.failedReason = failedReason;
    }

    public List<String> getStackTrace() {
        return new ArrayList<>(stackTrace);
    }

    public void addStackTrace(String trace) {
        this.stackTrace.add(trace);
    }

    public Long getFinishedOn() {
        return finishedOn;
    }

    public void setFinishedOn(Long finishedOn) {
        this.finishedOn = finishedOn;
    }

    public Long getProcessedOn() {
        return processedOn;
    }

    public void setProcessedOn(Long processedOn) {
        this.processedOn = processedOn;
    }

    public String getParentKey() {
        return parentKey;
    }

    public void setParentKey(String parentKey) {
        this.parentKey = parentKey;
    }

    public Object getParent() {
        return parent;
    }

    public void setParent(Object parent) {
        this.parent = parent;
    }

    public String getRepeatJobKey() {
        return repeatJobKey;
    }

    public void setRepeatJobKey(String repeatJobKey) {
        this.repeatJobKey = repeatJobKey;
    }

    public RepeatOptions getRepeat() {
        return repeat;
    }

    public void setRepeat(RepeatOptions repeat) {
        this.repeat = repeat;
    }

    public String getDeduplicationId() {
        return deduplicationId;
    }

    public void setDeduplicationId(String deduplicationId) {
        this.deduplicationId = deduplicationId;
    }

    public String getDeferredFailure() {
        return deferredFailure;
    }

    public void setDeferredFailure(String deferredFailure) {
        this.deferredFailure = deferredFailure;
    }

    public String getToken() {
        return token;
    }

    public void setToken(String token) {
        this.token = token;
    }

    /**
     * Serializes the job's data to JSON string.
     */
    public String dataJson() throws JsonProcessingException {
        if (data == null) {
            return "{}";
        }
        if (data instanceof String) {
            return (String) data;
        }
        return objectMapper.writeValueAsString(data);
    }

    /**
     * Returns a string representation of the job for debugging.
     */
    @Override
    public String toString() {
        return "Job{" +
                "id='" + id + '\'' +
                ", name='" + name + '\'' +
                ", queueName='" + queueName + '\'' +
                ", timestamp=" + timestamp +
                ", delay=" + delay +
                ", priority=" + priority +
                ", attempts=" + attempts +
                ", attemptsMade=" + attemptsMade +
                ", state='" + getStateString() + '\'' +
                '}';
    }

    /**
     * Returns the current state of this job.
     */
    public JobState getState() throws Exception {
        return backend.getState(id);
    }

    /**
     * Safely gets the state of this job, returning UNKNOWN if an error occurs.
     *
     * @return the job state or JobState.UNKNOWN if unable to determine
     */
    private JobState getStateString() {
        try {
            JobState state = getState();
            return state != null ? state : JobState.UNKNOWN;
        } catch (Exception e) {
            return JobState.UNKNOWN;
        }
    }

    // Additional methods for job operations would go here
    // These would delegate to the backend like in the .NET version
}