package io.bullmq.spring.config;

import io.bullmq.core.options.BackoffOptions;
import io.bullmq.core.options.ConnectionOptions;
import io.bullmq.core.options.JobsOptions;
import io.bullmq.core.options.KeepJobs;
import io.bullmq.core.options.QueueOptions;
import io.bullmq.core.options.RepeatOptions;
import io.bullmq.core.options.WorkerOptions;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

import java.util.HashMap;
import java.util.Map;

/**
 * Configuration properties for BullMQ.
 */
@ConfigurationProperties(prefix = "bullmq")
@Validated
public class BullMQProperties {
    /**
     * Connection settings for Redis.
     */
    private ConnectionOptions connection = new ConnectionOptions();

    /**
     * Redis key prefix. Defaults to "bull".
     */
    private String prefix = "bull";

    /**
     * Default queue options.
     */
    private QueueOptions queue = new QueueOptions();

    /**
     * Default worker options.
     */
    private WorkerOptions worker = new WorkerOptions();

    /**
     * Default job options.
     */
    private JobsOptions job = new JobsOptions();

    /**
     * Default repeat options.
     */
    private RepeatOptions repeat = new RepeatOptions();

    /**
     * Default backoff options.
     */
    private BackoffOptions backoff = new BackoffOptions();

    /**
     * Default keep jobs options.
     */
    private KeepJobs keepJobs = new KeepJobs();

    // Additional properties map for extensibility
    private Map<String, Object> additionalProperties = new HashMap<>();

    public ConnectionOptions getConnection() {
        return connection;
    }

    public void setConnection(ConnectionOptions connection) {
        this.connection = connection;
    }

    public String getPrefix() {
        return prefix;
    }

    public void setPrefix(String prefix) {
        this.prefix = prefix;
    }

    public QueueOptions getQueue() {
        return queue;
    }

    public void setQueue(QueueOptions queue) {
        this.queue = queue;
    }

    public WorkerOptions getWorker() {
        return worker;
    }

    public void setWorker(WorkerOptions worker) {
        this.worker = worker;
    }

    public JobsOptions getJob() {
        return job;
    }

    public void setJob(JobsOptions job) {
        this.job = job;
    }

    public RepeatOptions getRepeat() {
        return repeat;
    }

    public void setRepeat(RepeatOptions repeat) {
        this.repeat = repeat;
    }

    public BackoffOptions getBackoff() {
        return backoff;
    }

    public void setBackoff(BackoffOptions backoff) {
        this.backoff = backoff;
    }

    public KeepJobs getKeepJobs() {
        return keepJobs;
    }

    public void setKeepJobs(KeepJobs keepJobs) {
        this.keepJobs = keepJobs;
    }

    public Map<String, Object> getAdditionalProperties() {
        return additionalProperties;
    }

    public void setAdditionalProperties(Map<String, Object> additionalProperties) {
        this.additionalProperties = additionalProperties;
    }
}