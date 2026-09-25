package io.bullmq.core;

import io.bullmq.core.options.JobsOptions;
import io.bullmq.core.options.RepeatOptions;
import io.bullmq.core.options.WorkerOptions;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Processes jobs from a queue. As soon as it is created (and unless
 * {@link WorkerOptions#isAutorun()} is disabled) it starts fetching and
 * processing jobs concurrently up to {@link WorkerOptions#getConcurrency()}.
 */
public class Worker implements AutoCloseable {
    private final QueueBackend backend;
    private final Processor processor;
    private final WorkerOptions opts;
    private final ObjectMapper objectMapper;

    // Cancellation tokens equivalent
    private volatile boolean closing = false;
    private volatile boolean forceClosing = false;

    private Semaphore slots;
    private final AtomicLong tokenCounter = new AtomicLong();
    private volatile boolean drained = false;
    private Thread runningThread;
    private LockManager lockManager;
    private Thread stalledChecker;

    /**
     * A unique id for this worker instance.
     */
    private final String id = java.util.UUID.randomUUID().toString();

    /**
     * The queue name this worker consumes from.
     */
    private final String name;

    /**
     * The options this worker was created with.
     */
    public final WorkerOptions getOpts() {
        return opts;
    }

    /**
     * Raised when a job becomes active (starts processing).
     */
    public interface ActiveListener {
        void onActive(Job job);
    }
    private ActiveListener activeListener;

    /**
     * Raised when a job completes successfully.
     */
    public interface CompletedListener {
        void onCompleted(Job job, Object result);
    }
    private CompletedListener completedListener;

    /**
     * Raised when a job fails.
     */
    public interface FailedListener {
        void onFailed(Job job, Exception exception);
    }
    private FailedListener failedListener;

    /**
     * Raised when the worker drains the waiting list.
     */
    public interface DrainedListener {
        void onDrained();
    }
    private DrainedListener drainedListener;

    /**
     * Raised when a non-fatal error occurs.
     */
    public interface ErrorListener {
        void onError(Exception exception);
    }
    private ErrorListener errorListener;

    /**
     * Raised when a job has stalled and been moved back to wait.
     */
    public interface StalledListener {
        void onStalled(String jobId);
    }
    private StalledListener stalledListener;

    /**
     * Raised when lock renewal fails for one or more jobs.
     */
    public interface LockRenewalFailedListener {
        void onLockRenewalFailed(List<String> jobIds);
    }
    private LockRenewalFailedListener lockRenewalFailedListener;

    /**
     * Raised when locks are successfully renewed.
     */
    public interface LocksRenewedListener {
        void onLocksRenewed(List<String> jobIds);
    }
    private LocksRenewedListener locksRenewedListener;

    /**
     * Constructs a new Worker.
     */
    public Worker(String name, Processor processor, WorkerOptions opts, QueueBackend backend) {
        this.name = name;
        this.processor = processor;
        this.opts = opts;
        this.backend = backend;
        this.objectMapper = new ObjectMapper().disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);

        if (opts.getConnection().getMultiplexer() == null) {
            throw new IllegalArgumentException("Worker requires a connection");
        }

        if (opts.getConcurrency() < 1) {
            throw new IllegalArgumentException(
                    "WorkerOptions.Concurrency must be greater than 0.");
        }

        initBackend();

        if (opts.isAutorun()) {
            runAsync();
        }
    }

    private void initBackend() {
        try {
            backend.waitUntilReady();

            int lockRenewTime = opts.getLockRenewTime() != null ?
                    opts.getLockRenewTime() : opts.getLockDuration() / 2;

            lockManager = new LockManager(
                    backend,
                    lockRenewTime,
                    opts.getLockDuration(),
                    err -> {
                        if (errorListener != null) {
                            errorListener.onError(err);
                        }
                    },
                    jobIds -> {
                        if (lockRenewalFailedListener != null) {
                            lockRenewalFailedListener.onLockRenewalFailed(jobIds);
                        }
                    },
                    jobIds -> {
                        if (locksRenewedListener != null) {
                            locksRenewedListener.onLocksRenewed(jobIds);
                        }
                    });

        } catch (Exception e) {
            throw new RuntimeException("Failed to initialize worker backend", e);
        }
    }

    /**
     * Waits until the worker's connection is ready.
     */
    public void waitUntilReady() {
        backend.waitUntilReady();
    }

    /**
     * Starts processing (only needed when {@link WorkerOptions#isAutorun()} is
     * disabled). Returns a task that completes when the worker stops.
     */
    public void runAsync() {
        if (runningThread != null && runningThread.isAlive()) {
            return; // Already running
        }

        runningThread = new Thread(this::runInternal);
        runningThread.setDaemon(true);
        runningThread.start();
    }

    private void runInternal() {
        try {
            backend.waitUntilReady();

            int concurrency = opts.getConcurrency();
            slots = new Semaphore(concurrency);

            if (!opts.isSkipLockRenewal()) {
                lockManager.start();
            }

            if (!opts.isSkipStalledCheck()) {
                stalledChecker = new Thread(this::stalledCheckerLoop);
                stalledChecker.setDaemon(true);
                stalledChecker.start();
            }

            mainLoop();
        } catch (Exception e) {
            if (errorListener != null && !closing) {
                errorListener.onError(e);
            }
        } finally {
            // Cleanup
            if (!forceClosing) {
                // Wait for all slots to be released (drain in-flight jobs)
                try {
                    for (int i = 0; i < opts.getConcurrency(); i++) {
                        slots.acquire();
                    }
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            }

            if (lockManager != null) {
                lockManager.close();
            }

            if (stalledChecker != null) {
                stalledChecker.interrupt();
                try {
                    stalledChecker.join(1000);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
            }

            backend.close();
        }
    }

    private void mainLoop() {
        while (!closing) {
            try {
                if (!slots.tryAcquire(200, java.util.concurrent.TimeUnit.MILLISECONDS)) {
                    continue; // Try again
                }
            } catch (InterruptedException e) {
                if (closing) {
                    break;
                }
                Thread.currentThread().interrupt();
                continue;
            }

            if (closing) {
                slots.release();
                break;
            }

            String token = id + ":" + tokenCounter.incrementAndGet();
            NextJobData next;
            try {
                next = backend.moveToActive(token, opts.getName());
            } catch (Exception ex) {
                slots.release();
                if (!closing) {
                    if (errorListener != null) {
                        errorListener.onError(ex);
                    }
                }
                try {
                    Thread.sleep(200);
                } catch (InterruptedException ignored) {
                    Thread.currentThread().interrupt();
                }
                continue;
            }

            if (next.getJobId() != null) {
                drained = false;
                Job job = backend.getJob(next.getJobId());
                if (job != null) {
                    job.setToken(token);
                    if (job.getRepeatJobKey() != null) {
                        // Schedule next iteration for repeatable job
                        scheduleNextIteration(job);
                    }

                    // Process job asynchronously
                    Thread jobThread = new Thread(() -> runJob(job, token));
                    jobThread.setDaemon(true);
                    jobThread.start();
                } else {
                    slots.release();
                }
            } else {
                if (!drained) {
                    drained = true;
                    if (drainedListener != null) {
                        drainedListener.onDrained();
                    }
                }

                slots.release();
                waitForJob(next.getDelayUntil());
            }
        }
    }

    private void runJob(Job job, String token) {
        try {
            long ts = job.getProcessedOn() != null ? job.getProcessedOn() : System.currentTimeMillis();
            lockManager.trackJob(job.getId(), token, ts);

            if (activeListener != null) {
                activeListener.onActive(job);
            }

            Object result = processor.process(job);

            try {
                backend.moveToCompleted(job,
                        objectToJson(result),
                        job.getOpts().getRemoveOnComplete(),
                        token,
                        false);

                if (completedListener != null) {
                    completedListener.onCompleted(job, result);
                }
            } catch (Exception moveError) {
                if (errorListener != null) {
                    errorListener.onError(moveError);
                }
            }
        } catch (Exception ex) {
            try {
                backend.moveToFailed(job,
                        ex.getMessage(),
                        job.getOpts().getRemoveOnFail(),
                        token,
                        false,
                        ex.getStackTrace()[0].toString());

                if (failedListener != null) {
                    failedListener.onFailed(job, ex);
                }
            } catch (Exception moveError) {
                if (errorListener != null) {
                    errorListener.onError(moveError);
                }
            }
        } finally {
            lockManager.untrackJob(job.getId());
            slots.release();
        }
    }

    private void scheduleNextIteration(Job job) {
        try {
            if (job.getRepeat() == null) {
                return;
            }

            // Check if job scheduler exists
            String repeatJobKey = job.getRepeatJobKey();
            if (repeatJobKey != null && !backend.isJobScheduler(repeatJobKey)) {
                return;
            }

            // Upsert the job scheduler
            backend.addJobScheduler(
                    repeatJobKey,
                    null, // nextMillis - compute from repeat options
                    objectToJson(job.getData()),
                    jobToMap(job.getOpts()), // templateOpts
                    jobToMap(job.getOpts()), // schedulerOpts
                    jobToMap(job.getOpts()), // delayedJobOpts
                    job.getId() // producerId
            );
        } catch (Exception ex) {
            if (errorListener != null) {
                errorListener.onError(new Exception(
                        "Failed to add repeatable job for next iteration: " + ex.getMessage(), ex));
            }
        }
    }

    private void waitForJob(long delayUntil) {
        long now = System.currentTimeMillis();
        if (delayUntil > 0 && delayUntil > now) {
            long delta = Math.min(delayUntil - now,
                    Math.min(Math.max(opts.getDrainDelay(), 1), 10) * 1000);
            try {
                Thread.sleep(delta);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            return;
        }

        // Blocking wait for job
        MarkerResult result = backend.waitForJob(Math.min(Math.max(opts.getDrainDelay(), 1), 10));
        // Process result if needed
    }

    private void stalledCheckerLoop() {
        while (!closing) {
            try {
                List<String> stalled = backend.moveStalledJobsToWaitAsync(
                        opts.getMaxStalledCount(),
                        opts.getStalledInterval());
                for (String jobId : stalled) {
                    if (stalledListener != null) {
                        stalledListener.onStalled(jobId);
                    }
                }
            } catch (Exception ex) {
                if (!closing && errorListener != null) {
                    errorListener.onError(ex);
                }
            }

            try {
                Thread.sleep(opts.getStalledInterval());
            } catch (InterruptedException e) {
                if (closing) {
                    break;
                }
                Thread.currentThread().interrupt();
            }
        }
    }

    private String objectToJson(Object obj) {
        if (obj == null) {
            return "{}";
        }
        if (obj instanceof String) {
            return (String) obj;
        }
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (Exception e) {
            return obj.toString();
        }
    }

    private Map<String, Object> jobToMap(JobsOptions opts) {
        // Simplified conversion - in reality would need proper JSON serialization
        return java.util.Collections.emptyMap();
    }

    @Override
    public void close() {
        closing = true;

        if (runningThread != null) {
            runningThread.interrupt();
            try {
                runningThread.join(5000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    /**
     * A processor function that handles a job and returns its result.
     */
    @FunctionalInterface
    public interface Processor {
        Object process(Job job) throws Exception;
    }

    /**
     * Simple lock manager for job locks.
     */
    private static class LockManager {
        private final QueueBackend backend;
        private final int lockRenewTime;
        private final int lockDuration;
        private final java.util.function.Consumer<Exception> errorHandler;
        private final java.util.function.Consumer<java.util.List<String>> lockRenewalFailedHandler;
        private final java.util.function.Consumer<java.util.List<String>> locksRenewedHandler;
        private volatile boolean running = false;
        private Thread renewThread;

        LockManager(QueueBackend backend, int lockRenewTime, int lockDuration,
                    java.util.function.Consumer<Exception> errorHandler,
                    java.util.function.Consumer<java.util.List<String>> lockRenewalFailedHandler,
                    java.util.function.Consumer<java.util.List<String>> locksRenewedHandler) {
            this.backend = backend;
            this.lockRenewTime = lockRenewTime;
            this.lockDuration = lockDuration;
            this.errorHandler = errorHandler;
            this.lockRenewalFailedHandler = lockRenewalFailedHandler;
            this.locksRenewedHandler = locksRenewedHandler;
        }

        void start() {
            running = true;
            renewThread = new Thread(this::renewLoop);
            renewThread.setDaemon(true);
            renewThread.start();
        }

        void close() {
            running = false;
            if (renewThread != null) {
                renewThread.interrupt();
                try {
                    renewThread.join(1000);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }

        void trackJob(String jobId, String token, long timestamp) {
            // In a real implementation, this would store the lock info
            // and schedule renewal
        }

        void untrackJob(String jobId) {
            // Remove tracking
        }

        private void renewLoop() {
            while (running) {
                try {
                    Thread.sleep(lockRenewTime);
                    // Renew locks for tracked jobs
                    // This is simplified - real implementation would renew actual locks
                } catch (InterruptedException e) {
                    if (!running) {
                        break;
                    }
                    Thread.currentThread().interrupt();
                } catch (Exception ex) {
                    if (running) {
                        errorHandler.accept(ex);
                    }
                }
            }
        }
    }
}