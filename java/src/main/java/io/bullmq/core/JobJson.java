package io.bullmq.core;

import com.fasterxml.jackson.databind.JsonNode;
import io.bullmq.core.options.JobsOptions;
import io.bullmq.core.options.RepeatOptions;

import java.util.Map;

/**
 * Represents a job's raw Redis representation (JSON format).
 */
public class JobJson {
    private String id;
    private String name;
    private String data;
    private long timestamp;
    private long delay;
    private int attemptsMade;
    private int attemptsStarted;
    private int stalledCounter;
    private Long finishedOn;
    private Long processedOn;
    private String failedReason;
    private String repeatJobKey;
    private String parentKey;
    private String deferredFailure;
    private String progress;
    private String returnValue;
    private String stackTrace;
    private String opts; // JSON string of JobsOptions

    // Getters and setters
    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getData() {
        return data;
    }

    public void setData(String data) {
        this.data = data;
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

    public String getFailedReason() {
        return failedReason;
    }

    public void setFailedReason(String failedReason) {
        this.failedReason = failedReason;
    }

    public String getRepeatJobKey() {
        return repeatJobKey;
    }

    public void setRepeatJobKey(String repeatJobKey) {
        this.repeatJobKey = repeatJobKey;
    }

    public String getParentKey() {
        return parentKey;
    }

    public void setParentKey(String parentKey) {
        this.parentKey = parentKey;
    }

    public String getDeferredFailure() {
        return deferredFailure;
    }

    public void setDeferredFailure(String deferredFailure) {
        this.deferredFailure = deferredFailure;
    }

    public String getProgress() {
        return progress;
    }

    public void setProgress(String progress) {
        this.progress = progress;
    }

    public String getReturnValue() {
        return returnValue;
    }

    public void setReturnValue(String returnValue) {
        this.returnValue = returnValue;
    }

    public String getStackTrace() {
        return stackTrace;
    }

    public void setStackTrace(String stackTrace) {
        this.stackTrace = stackTrace;
    }

    public String getOpts() {
        return opts;
    }

    public void setOpts(String opts) {
        this.opts = opts;
    }

    /**
     * Creates a JobJson from a map (like Redis HashGetAll result).
     */
    public static JobJson fromMap(Map<String, String> map, String jobId) {
        JobJson json = new JobJson();
        json.setId(jobId != null ? jobId : map.getOrDefault("id", ""));
        json.setName(map.getOrDefault("name", ""));
        json.setData(map.getOrDefault("data", "{}"));
        json.setTimestamp(Long.parseLong(map.getOrDefault("timestamp", "0")));
        json.setDelay(Long.parseLong(map.getOrDefault("delay", "0")));
        json.setAttemptsMade(Integer.parseInt(map.getOrDefault("attemptsMade", "0")));
        json.setAttemptsStarted(Integer.parseInt(map.getOrDefault("attemptsStarted", "0")));
        json.setStalledCounter(Integer.parseInt(map.getOrDefault("stalledCounter", "0")));

        String finishedOn = map.get("finishedOn");
        if (finishedOn != null && !finishedOn.isEmpty()) {
            json.setFinishedOn(Long.parseLong(finishedOn));
        }

        String processedOn = map.get("processedOn");
        if (processedOn != null && !processedOn.isEmpty()) {
            json.setProcessedOn(Long.parseLong(processedOn));
        }

        json.setFailedReason(map.get("failedReason"));
        json.setRepeatJobKey(map.get("repeatJobKey"));
        json.setParentKey(map.get("parentKey"));
        json.setDeferredFailure(map.get("deferredFailure"));
        json.setProgress(map.get("progress"));
        json.setReturnValue(map.get("returnValue"));
        json.setStackTrace(map.get("stackTrace"));
        json.setOpts(map.get("opts"));

        return json;
    }

    /**
     * Converts this JobJson to a Job object.
     */
    public Job toJob(QueueBackend backend, String queueName) throws Exception {
        // Parse opts JSON back to JobsOptions
        JobsOptions jobOpts = new JobsOptions();
        if (opts != null && !opts.isEmpty()) {
            // In a real implementation, we'd parse the JSON here
            // For simplicity, we'll leave it as default options
            // TODO: Implement proper JSON parsing for JobsOptions
        }

        Job job = new Job(backend, queueName, name, data, jobOpts);
        job.setId(id);
        job.setTimestamp(timestamp);
        job.setDelay(delay);
        job.setAttemptsMade(attemptsMade);
        job.setAttemptsStarted(attemptsStarted);
        job.setStalledCounter(stalledCounter);
        job.setFinishedOn(finishedOn);
        job.setProcessedOn(processedOn);
        job.setFailedReason(failedReason);
        job.setRepeatJobKey(repeatJobKey);
        job.setParentKey(parentKey);
        job.setDeferredFailure(deferredFailure);

        if (progress != null && !progress.isEmpty()) {
            // TODO: Parse progress JSON
            job.setProgress(progress);
        }

        if (returnValue != null && !returnValue.isEmpty()) {
            // TODO: Parse returnValue JSON
            job.setReturnValue(returnValue);
        }

        if (stackTrace != null && !stackTrace.isEmpty()) {
            // TODO: Parse stackTrace JSON array
            // For now, just add as single entry
            job.addStackTrace(stackTrace);
        }

        // TODO: Parse repeat options from opts
        // This would require parsing the opts JSON and extracting repeat section

        return job;
    }
}