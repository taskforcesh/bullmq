package io.bullmq.core;

import io.bullmq.core.options.ConnectionOptions;
import io.bullmq.core.options.JobsOptions;
import io.bullmq.core.options.RepeatOptions;
import io.lettuce.core.*;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.api.sync.RedisCommands;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

/**
 * Redis implementation of {@link QueueBackend}.
 *
 * This implementation uses Lettuce as the Redis client and executes
 * Lua scripts for atomic operations.
 *
 * NOTE: This is a simplified implementation for demonstration purposes.
 * A production implementation would use actual Lua scripts and proper
 * Redis operations.
 */
public class RedisBackend implements QueueBackend {
    private final String name;
    private final String prefix;
    private final RedisClient redisClient;
    private final StatefulRedisConnection<String, String> connection;
    private final StatefulRedisConnection<String, String> blockingConnection;
    private final boolean ownsConnection;
    private final QueueKeys queueKeys;
    private final Map<String, String> keys;
    private final int lockDuration;
    private final String workerName;
    private volatile boolean closing = false;

    public RedisBackend(
            String name,
            RedisClient redisClient,
            String prefix,
            boolean ownsConnection,
            StatefulRedisConnection<String, String> blockingConnection,
            int lockDuration,
            String workerName) {
        this.name = name;
        this.prefix = prefix;
        this.redisClient = redisClient;
        this.connection = redisClient.connect();
        this.blockingConnection = blockingConnection;
        this.ownsConnection = ownsConnection;
        this.lockDuration = lockDuration;
        this.workerName = workerName;
        this.queueKeys = new QueueKeys(prefix);
        this.keys = queueKeys.getKeys(name);
    }

    /**
     * Creates a Redis backend, establishing a connection from the options.
     */
    public static RedisBackend createAsync(
            String name,
            ConnectionOptions options,
            int lockDuration,
            String workerName,
            boolean withBlockingConnection) throws Exception {

        RedisClient client;
        boolean ownsConn;

        if (options.getConnectionString() != null && !options.getConnectionString().isEmpty()) {
            client = RedisClient.create(options.getConnectionString());
            ownsConn = true;
        } else {
            // Fallback - in real implementation would handle other connection types
            client = RedisClient.create();
            ownsConn = true;
        }

        StatefulRedisConnection<String, String> blockingConn = null;
        if (withBlockingConnection) {
            blockingConn = client.connect();
        }

        return new RedisBackend(
                name,
                client,
                options.getPrefix(),
                ownsConn,
                blockingConn,
                lockDuration,
                workerName);
    }

    @Override
    public String getName() {
        return name;
    }

    @Override
    public String getPrefix() {
        return prefix;
    }

    @Override
    public void waitUntilReady() {
        // Wait for connection to be ready
        connection.sync().ping();
        if (blockingConnection != null) {
            blockingConnection.sync().ping();
        }
    }

    @Override
    public void close() {
        closing = true;
        try {
            if (blockingConnection != null && blockingConnection.isOpen()) {
                blockingConnection.close();
            }
        } catch (Exception e) {
            // Ignore
        }
        try {
            if (connection.isOpen()) {
                connection.close();
            }
        } catch (Exception e) {
            // Ignore
        }
        if (ownsConnection && redisClient != null) {
            redisClient.shutdown();
        }
    }

    // Key mapping helper
    private String[] mapKeys(String... names) {
        String[] result = new String[names.length];
        for (int i = 0; i < names.length; i++) {
            result[i] = keys.get(names[i]);
        }
        return result;
    }

    // Job storage simulation (in real implementation, this would be in Redis)
    private final Map<String, Job> jobStore = new ConcurrentHashMap<>();
    private final Map<String, List<String>> queues = new ConcurrentHashMap<>();
    private final Map<String, Set<String>> sortedSets = new ConcurrentHashMap<>();
    private long jobIdCounter = 0;

    private String getQueueKey(String type) {
        return keys.getOrDefault(type, type);
    }

    @Override
    public String addJob(Job job) {
        // Generate job ID if not provided
        String jobId = job.getId() != null ? job.getId() : String.valueOf(++jobIdCounter);
        job.setId(jobId);

        // Store job
        jobStore.put(jobId, job);

        // Add to appropriate queue based on job options
        String queueKey;
        if (job.getDelay() > 0) {
            queueKey = getQueueKey("delayed");
            sortedSets.computeIfAbsent(queueKey, k -> ConcurrentHashMap.newKeySet()).add(jobId);
            // In real implementation, would use score as timestamp + delay
        } else if (job.getPriority() > 0) {
            queueKey = getQueueKey("prioritized");
            sortedSets.computeIfAbsent(queueKey, k -> ConcurrentHashMap.newKeySet()).add(jobId);
            queues.computeIfAbsent(getQueueKey("wait"), k -> new ArrayList<>()).add(jobId);
        } else {
            queueKey = getQueueKey("wait");
            queues.computeIfAbsent(queueKey, k -> new ArrayList<>()).add(jobId);
        }

        return jobId;
    }

    @Override
    public List<String> addJobs(List<Job> jobs) {
        List<String> ids = new ArrayList<>();
        for (Job job : jobs) {
            ids.add(addJob(job));
        }
        return ids;
    }

    @Override
    public JobState getState(String jobId) throws Exception {
        if (!jobStore.containsKey(jobId)) {
            return JobState.UNKNOWN;
        }

        Job job = jobStore.get(jobId);
        // Simplified state determination
        // In real implementation, would check Redis for which set/list the job is in
        if (job.getDelay() > 0 && System.currentTimeMillis() < job.getTimestamp() + job.getDelay()) {
            return JobState.DELAYED;
        }
        // Simplified - assume active if being processed
        return JobState.WAITING; // Default to waiting
    }

    @Override
    public Job getJob(String jobId) {
        return jobStore.get(jobId);
    }

    @Override
    public Map<String, Long> getJobCounts(String... types) {
        Map<String, Long> result = new HashMap<>();
        if (types.length == 0) {
            types = new String[]{"waiting", "active", "completed", "failed", "delayed", "paused"};
        }

        for (String type : types) {
            long count = 0;
            switch (type) {
                case "waiting":
                    count = queues.getOrDefault(getQueueKey("wait"), Collections.emptyList()).size();
                    break;
                case "active":
                    // Simplified
                    count = 0;
                    break;
                case "completed":
                    count = sortedSets.getOrDefault(getQueueKey("completed"), Collections.emptySet()).size();
                    break;
                case "failed":
                    count = sortedSets.getOrDefault(getQueueKey("failed"), Collections.emptySet()).size();
                    break;
                case "delayed":
                    count = sortedSets.getOrDefault(getQueueKey("delayed"), Collections.emptySet()).size();
                    break;
                case "paused":
                    count = queues.getOrDefault(getQueueKey("paused"), Collections.emptyList()).size();
                    break;
                default:
                    count = 0;
            }
            result.put(type, count);
        }
        return result;
    }

    @Override
    public void pause() {
        // In real implementation, would set a flag in Redis
        // For simulation, we'll just note it
    }

    @Override
    public void resume() {
        // In real implementation, would remove the flag from Redis
    }

    @Override
    public boolean isPaused() {
        // Simplified
        return false;
    }

    @Override
    public List<Job> getWaiting(int start, int end) {
        List<String> ids = queues.getOrDefault(getQueueKey("wait"), Collections.emptyList());
        if (start < 0) start = 0;
        if (end < 0 || end >= ids.size()) end = ids.size() - 1;
        if (start > end) return Collections.emptyList();

        List<String> subList = ids.subList(start, Math.min(end + 1, ids.size()));
        List<Job> jobs = new ArrayList<>();
        for (String id : subList) {
            Job job = jobStore.get(id);
            if (job != null) {
                jobs.add(job);
            }
        }
        return jobs;
    }

    @Override
    public List<Job> getActive(int start, int end) {
        // Simplified
        return Collections.emptyList();
    }

    @Override
    public List<Job> getCompleted(int start, int end) {
        Set<String> ids = sortedSets.getOrDefault(getQueueKey("completed"), Collections.emptySet());
        List<String> idList = new ArrayList<>(ids);
        Collections.sort(idList);
        if (start < 0) start = 0;
        if (end < 0 || end >= idList.size()) end = idList.size() - 1;
        if (start > end) return Collections.emptyList();

        List<String> subList = idList.subList(start, Math.min(end + 1, idList.size()));
        List<Job> jobs = new ArrayList<>();
        for (String id : subList) {
            Job job = jobStore.get(id);
            if (job != null) {
                jobs.add(job);
            }
        }
        return jobs;
    }

    @Override
    public List<Job> getFailed(int start, int end) {
        Set<String> ids = sortedSets.getOrDefault(getQueueKey("failed"), Collections.emptySet());
        List<String> idList = new ArrayList<>(ids);
        Collections.sort(idList);
        if (start < 0) start = 0;
        if (end < 0 || end >= idList.size()) end = idList.size() - 1;
        if (start > end) return Collections.emptyList();

        List<String> subList = idList.subList(start, Math.min(end + 1, idList.size()));
        List<Job> jobs = new ArrayList<>();
        for (String id : subList) {
            Job job = jobStore.get(id);
            if (job != null) {
                jobs.add(job);
            }
        }
        return jobs;
    }

    @Override
    public List<Job> getDelayed(int start, int end) {
        Set<String> ids = sortedSets.getOrDefault(getQueueKey("delayed"), Collections.emptySet());
        List<String> idList = new ArrayList<>(ids);
        Collections.sort(idList);
        if (start < 0) start = 0;
        if (end < 0 || end >= idList.size()) end = idList.size() - 1;
        if (start > end) return Collections.emptyList();

        List<String> subList = idList.subList(start, Math.min(end + 1, idList.size()));
        List<Job> jobs = new ArrayList<>();
        for (String id : subList) {
            Job job = jobStore.get(id);
            if (job != null) {
                jobs.add(job);
            }
        }
        return jobs;
    }

    @Override
    public long remove(String jobId, boolean removeChildren) {
        boolean removed = jobStore.remove(jobId) != null;
        // In real implementation, would also remove from all queues/sets
        return removed ? 1L : 0L;
    }

    @Override
    public void pause(boolean pause) {
        if (pause) {
            pause();
        } else {
            resume();
        }
    }

    @Override
    public void drain(boolean delayed) {
        // Simplified implementation
        if (delayed) {
            // Move delayed to wait
            Set<String> delayedIds = sortedSets.getOrDefault(getQueueKey("delayed"), Collections.emptySet());
            List<String> waitList = queues.computeIfAbsent(getQueueKey("wait"), k -> new ArrayList<>());
            waitList.addAll(delayedIds);
            sortedSets.remove(getQueueKey("delayed"));
        } else {
            // Move wait to paused
            List<String> waitList = queues.getOrDefault(getQueueKey("wait"), Collections.emptyList());
            List<String> pausedList = queues.computeIfAbsent(getQueueKey("paused"), k -> new ArrayList<>());
            pausedList.addAll(waitList);
            waitList.clear();
        }
    }

    @Override
    public List<String> cleanJobsInSet(String set, long grace, int limit) {
        // Simplified
        String setKey = getQueueKey(set);
        Set<String> ids = sortedSets.getOrDefault(setKey, Collections.emptySet());
        long cutoff = System.currentTimeMillis() - grace;
        List<String> toRemove = new ArrayList<>();

        // In real implementation, would check timestamps
        // For simulation, just remove up to limit
        int count = 0;
        for (String id : ids) {
            if (count >= limit) break;
            toRemove.add(id);
            count++;
        }

        for (String id : toRemove) {
            ids.remove(id);
        }
        return toRemove;
    }

    @Override
    public long obliterate(boolean force, int count) {
        // Simplified implementation
        if (!force && !isPaused()) {
            return -1; // Cannot obliterate non-paused queue
        }

        long obliterated = 0;
        int processed = 0;

        // Collect all job IDs
        Set<String> allJobIds = new HashSet<>();
        allJobIds.addAll(queues.getOrDefault(getQueueKey("wait"), Collections.emptyList()));
        allJobIds.addAll(queues.getOrDefault(getQueueKey("paused"), Collections.emptyList()));
        allJobIds.addAll(sortedSets.getOrDefault(getQueueKey("delayed"), Collections.emptySet()));
        allJobIds.addAll(sortedSets.getOrDefault(getQueueKey("completed"), Collections.emptySet()));
        allJobIds.addAll(sortedSets.getOrDefault(getQueueKey("failed"), Collections.emptySet()));

        for (String id : allJobIds) {
            if (processed >= count) break;
            if (remove(id, true) > 0) {
                obliterated++;
            }
            processed++;
        }

        // Clear meta
        // In real implementation, would clear Redis meta hash

        return obliterated;
    }

    @Override
    public long extendLock(String jobId, String token, int duration) {
        // Simplified
        return jobStore.containsKey(jobId) ? 1L : 0L;
    }

    @Override
    public List<String> extendLocks(List<String> jobIds, List<String> tokens, int duration) {
        List<String> results = new ArrayList<>();
        for (int i = 0; i < jobIds.size(); i++) {
            String jobId = jobIds.get(i);
            String token = i < tokens.size() ? tokens.get(i) : "";
            results.add(String.valueOf(extendLock(jobId, token, duration)));
        }
        return results;
    }

    @Override
    public void updateProgress(String jobId, Object progress) {
        Job job = jobStore.get(jobId);
        if (job != null) {
            job.setProgress(progress);
        }
    }

    @Override
    public void updateData(String jobId, Object data) {
        Job job = jobStore.get(jobId);
        if (job != null) {
            job.setData(data);
        }
    }

    @Override
    public void changePriority(String jobId, int priority, boolean lifo) {
        // Simplified - would move between queues in real implementation
        Job job = jobStore.get(jobId);
        if (job != null) {
            job.getOpts().setPriority(priority);
            job.getOpts().setLifo(lifo);
        }
    }

    @Override
    public void promote(String jobId) {
        // Move from delayed to wait
        Job job = jobStore.get(jobId);
        if (job != null) {
            sortedSets.remove(getQueueKey("delayed")).remove(jobId);
            queues.computeIfAbsent(getQueueKey("wait"), k -> new ArrayList<>()).add(jobId);
        }
    }

    @Override
    public long addLog(String jobId, String logRow, int keepLogs) {
        Job job = jobStore.get(jobId);
        if (job != null) {
            // In real implementation, would store in Redis list
            // For simulation, just return length
            return 1L;
        }
        return 0L;
    }

    @Override
    public JobLogs getJobLogs(String jobId, int start, int end, boolean asc) {
        // Simplified
        return new JobLogs(new String[]{"Simulated log entry"}, 1);
    }

    @Override
    public Map<String, String> getProcessedChildrenValues(String jobId) {
        // Simplified
        return Collections.emptyMap();
    }

    @Override
    public long getRateLimitTtl() {
        // Simplified
        return 0;
    }

    @Override
    public List<String> getRanges(List<String> types, int start, int end, boolean asc) {
        List<String> result = new ArrayList<>();
        for (String type : types) {
            List<String> ids = switch (type) {
                case "waiting" -> queues.getOrDefault(getQueueKey("wait"), Collections.emptyList());
                case "active" -> Collections.emptyList(); // Simplified
                case "completed" -> new ArrayList<>(sortedSets.getOrDefault(getQueueKey("completed"), Collections.emptySet()));
                case "failed" -> new ArrayList<>(sortedSets.getOrDefault(getQueueKey("failed"), Collections.emptySet()));
                case "delayed" -> new ArrayList<>(sortedSets.getOrDefault(getQueueKey("delayed"), Collections.emptySet()));
                case "paused" -> queues.getOrDefault(getQueueKey("paused"), Collections.emptyList());
                case "prioritized" -> new ArrayList<>(sortedSets.getOrDefault(getQueueKey("prioritized"), Collections.emptySet()));
                case "waiting-children" -> Collections.emptyList(); // Simplified
                default -> Collections.emptyList();
            };

            if (asc) {
                int from = Math.max(0, start);
                int to = Math.min(ids.size(), end >= 0 ? end + 1 : ids.size());
                if (from < to) {
                    result.addAll(ids.subList(from, to));
                }
            } else {
                // Descending
                List<String> desc = new ArrayList<>(ids);
                Collections.reverse(desc);
                int from = Math.max(0, start);
                int to = Math.min(desc.size(), end >= 0 ? end + 1 : desc.size());
                if (from < to) {
                    result.addAll(desc.subList(from, to));
                }
            }
        }
        return result;
    }

    @Override
    public long[] getCounts(String... types) {
        Map<String, Long> counts = getJobCounts(types);
        return Arrays.stream(types)
                .mapToLong(type -> counts.getOrDefault(type, 0L))
                .toArray();
    }

    @Override
    public long[] getCountsPerPriority(long... priorities) {
        // Simplified - would get counts per priority level
        return new long[priorities.length];
    }

    @Override
    public String addJobScheduler(String schedulerId, Long nextMillis, String templateData,
                                  Map<String, Object> templateOpts, Map<String, Object> schedulerOpts,
                                  Map<String, Object> delayedJobOpts, String producerId) {
        // Simplified implementation
        return schedulerId;
    }

    @Override
    public String updateJobSchedulerNextMillis(String schedulerId, long nextMillis,
                                               String templateData, Map<String, Object> delayedJobOpts,
                                               String producerId) {
        // Simplified implementation
        return schedulerId;
    }

    @Override
    public long removeJobScheduler(String schedulerId) {
        // Simplified implementation
        return 0;
    }

    @Override
    public Map<String, String> getJobScheduler(String id) {
        // Simplified implementation
        return Collections.emptyMap();
    }

    @Override
    public boolean isJobScheduler(String id) {
        // Simplified implementation
        return false;
    }

    @Override
    public Map<String, String> getJobSchedulerData(String key) {
        // Simplified implementation
        return Collections.emptyMap();
    }

    @Override
    public List<String> getJobSchedulersRange(int start, int end, boolean asc) {
        // Simplified implementation
        return Collections.emptyList();
    }

    @Override
    public long getJobSchedulersCount() {
        // Simplified implementation
        return 0;
    }

    @Override
    public MarkerResult waitForJob(double blockTimeoutSeconds) {
        // Simplified implementation
        try {
            Thread.sleep((long) (blockTimeoutSeconds * 1000));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return new MarkerResult("", System.currentTimeMillis());
    }

    @Override
    public String publishEvent(List<String> fields, int maxEvents) {
        // Simplified implementation
        return "1640995200000-0";
    }

    @Override
    public List<EventEntry> readEvents(String id, double blockTimeoutSeconds) {
        // Simplified implementation
        try {
            Thread.sleep((long) (blockTimeoutSeconds * 1000));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return Collections.emptyList();
    }

    @Override
    public List<String> moveStalledJobsToWaitAsync(int count, int interval) {
        // Simplified implementation - in a real implementation, this would:
        // 1. Scan active jobs to find those that have been processing longer than the interval
        // 2. Move those jobs from active to waiting lists
        // 3. Return the IDs of moved jobs

        // For now, returning empty list as a placeholder
        return Collections.emptyList();
    }

    @Override
    public MoveToFinishedResult moveToFailed(Job job, String failedReason, Object removeOnFail, String token, boolean fetchNext, String stackTraceJson) {
        // Simplified implementation
        // In a real implementation, this would:
        // 1. Remove the job from active set
        // 2. Add it to failed set with appropriate metadata
        // 3. Update job attempts, failedAt timestamp, etc.
        // 4. Handle removal based on removeOnFail setting
        // 5. Return a MoveToFinishedResult with the job ID and previous state

        // For now, returning a basic result
        MoveToFinishedResult result = new MoveToFinishedResult();
        result.setFinishedOn(System.currentTimeMillis());
        // Note: In a real implementation, we would set more detailed next job data
        return result;
    }

    @Override
    public MoveToFinishedResult moveToCompleted(Job job, String returnValueJson, Object removeOnComplete, String token, boolean fetchNext) {
        // Simplified implementation
        // In a real implementation, this would:
        // 1. Remove the job from active set
        // 2. Add it to completed set with appropriate metadata
        // 3. Update job attempts, processedOn timestamp, etc.
        // 4. Handle removal based on removeOnComplete setting
        // 5. Return a MoveToFinishedResult with the job ID and previous state

        // For now, returning a basic result
        MoveToFinishedResult result = new MoveToFinishedResult();
        result.setFinishedOn(System.currentTimeMillis());
        // Note: In a real implementation, we would set more detailed next job data
        return result;
    }

    @Override
    public NextJobData moveToActive(String token, String workerName) {
        // Simplified implementation
        // In a real implementation, this would:
        // 1. Move a job from wait/prioritized/delayed lists to active list
        // 2. Lock the job for the worker
        // 3. Return NextJobData containing the job details

        // For now, returning an empty NextJobData as a placeholder
        return new NextJobData();
    }
}