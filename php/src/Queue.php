<?php

declare(strict_types=1);

namespace BullMQ;

use Ramsey\Uuid\Uuid;

/**
 * Queue client for BullMQ.
 *
 * This class provides the ability to add jobs to a queue that can be processed
 * by workers written in NodeJS, Python, or Elixir.
 *
 * @example
 * ```php
 * use BullMQ\Queue;
 *
 * $queue = new Queue('my-queue');
 * $job = $queue->add('my-job', ['foo' => 'bar']);
 * ```
 */
class Queue
{
    /**
     * The name of the queue.
     */
    public readonly string $name;

    /**
     * The prefix used for Redis keys.
     */
    private string $prefix;

    /**
     * The Redis connection.
     */
    private RedisConnection $connection;

    /**
     * Scripts executor.
     */
    private Scripts $scripts;

    /**
     * Queue keys helper.
     */
    private QueueKeys $keys;

    /**
     * Whether the queue owns the connection (should close it on cleanup).
     */
    private bool $ownsConnection = false;

    /**
     * Create a new Queue instance.
     *
     * @param string $name The name of the queue
     * @param array{
     *   prefix?: string,
     *   connection?: RedisConnection|array<string, mixed>|string
     * } $opts Queue options
     */
    public function __construct(string $name, array $opts = [])
    {
        $this->name = $name;
        $this->prefix = $opts['prefix'] ?? 'bull';

        // Handle connection option
        $connection = $opts['connection'] ?? [];
        if ($connection instanceof RedisConnection) {
            $this->connection = $connection;
        } else {
            $this->connection = new RedisConnection($connection);
            $this->ownsConnection = true;
        }

        $this->keys = new QueueKeys($this->prefix);
        $this->scripts = new Scripts($this->prefix, $this->name, $this->connection);
    }

    /**
     * Get the Redis connection.
     */
    public function getConnection(): RedisConnection
    {
        return $this->connection;
    }

    /**
     * Get the qualified name of the queue.
     */
    public function getQualifiedName(): string
    {
        return $this->keys->getQueueQualifiedName($this->name);
    }

    /**
     * Adds a new job to the queue.
     *
     * @param string $name The name of the job
     * @param mixed $data The data payload for the job
     * @param JobOptions|array<string, mixed> $opts Job options
     * @return Job The created job
     *
     * @example
     * ```php
     * // Simple job
     * $job = $queue->add('email', ['to' => 'user@example.com']);
     *
     * // Delayed job
     * $job = $queue->add('email', $data, ['delay' => 60000]); // 60 seconds
     *
     * // Priority job
     * $job = $queue->add('email', $data, ['priority' => 1]);
     * ```
     */
    public function add(string $name, mixed $data, JobOptions|array $opts = []): Job
    {
        $job = new Job($this, $name, $data, $opts);

        // Generate job ID if not provided
        if ($job->id === null) {
            $job->id = $this->generateJobId();
        }

        $this->scripts->addJob($job);

        return $job;
    }

    /**
     * Adds multiple jobs to the queue in bulk.
     *
     * @param array<array{name: string, data: mixed, opts?: JobOptions|array<string, mixed>}> $jobs
     * @return array<Job> Array of created jobs
     *
     * @example
     * ```php
     * $jobs = $queue->addBulk([
     *     ['name' => 'email', 'data' => ['to' => 'user1@example.com']],
     *     ['name' => 'email', 'data' => ['to' => 'user2@example.com']],
     * ]);
     * ```
     */
    public function addBulk(array $jobs): array
    {
        $createdJobs = [];

        foreach ($jobs as $jobData) {
            $name = $jobData['name'];
            $data = $jobData['data'];
            $opts = $jobData['opts'] ?? [];

            $job = new Job($this, $name, $data, $opts);
            if ($job->id === null) {
                $job->id = $this->generateJobId();
            }
            $createdJobs[] = $job;
        }

        // Execute all jobs atomically using a transaction (MULTI/EXEC)
        $client = $this->connection->getClient();
        $transaction = $client->transaction();

        foreach ($createdJobs as $job) {
            $this->scripts->addJobToTransaction($transaction, $job);
        }

        $results = $transaction->execute();

        // Check results for errors
        foreach ($results as $index => $result) {
            if (is_int($result) && $result < 0) {
                throw new \RuntimeException("Failed to add job at index {$index}: error code {$result}");
            }
            // Update job ID from result if returned
            if (is_string($result) && !empty($result)) {
                $createdJobs[$index]->id = $result;
            }
        }

        return $createdJobs;
    }

    /**
     * Pauses the processing of the queue.
     *
     * @return void
     */
    public function pause(): void
    {
        $this->scripts->pause(true);
    }

    /**
     * Resumes the processing of the queue.
     *
     * @return void
     */
    public function resume(): void
    {
        $this->scripts->pause(false);
    }

    /**
     * Checks if the queue is paused.
     *
     * @return bool True if the queue is paused
     */
    public function isPaused(): bool
    {
        $client = $this->connection->getClient();
        $pausedKey = $this->keys->toKey($this->name, 'meta');
        
        $paused = $client->hget($pausedKey, 'paused');
        
        return $paused === '1';
    }

    /**
     * Get the total count of jobs in a specific state.
     *
     * @param string ...$types The job states to count (waiting, active, delayed, completed, failed, paused, prioritized, waiting-children)
     * @return int The total count
     */
    public function getJobCountByTypes(string ...$types): int
    {
        $counts = $this->scripts->getCounts($types);
        return array_sum($counts);
    }

    /**
     * Get job counts for all states.
     *
     * @return array{waiting: int, active: int, delayed: int, completed: int, failed: int, paused: int, prioritized: int, waiting-children: int}
     */
    public function getJobCounts(): array
    {
        $types = ['waiting', 'active', 'delayed', 'completed', 'failed', 'paused', 'prioritized', 'waiting-children'];
        $counts = $this->scripts->getCounts($types);

        $result = [];
        foreach ($types as $i => $type) {
            $result[$type] = $counts[$i] ?? 0;
        }

        return $result;
    }

    /**
     * Get counts per priority.
     *
     * @param array<int> $priorities Array of priority levels to count
     * @return array<int, int> Priority to count mapping
     */
    public function getCountsPerPriority(array $priorities): array
    {
        $counts = $this->scripts->getCountsPerPriority($priorities);
        
        $result = [];
        foreach ($priorities as $i => $priority) {
            $result[$priority] = $counts[$i] ?? 0;
        }

        return $result;
    }

    /**
     * Get a job by its ID.
     *
     * @param string $jobId The job ID
     * @return Job|null The job, or null if not found
     */
    public function getJob(string $jobId): ?Job
    {
        $client = $this->connection->getClient();
        $jobKey = $this->keys->toKey($this->name, $jobId);
        
        $rawData = $client->hgetall($jobKey);
        
        if (empty($rawData)) {
            return null;
        }

        return Job::fromRaw($this, $rawData, $jobId);
    }

    /**
     * Get jobs by their IDs.
     *
     * @param array<string> $jobIds The job IDs
     * @return array<Job> Array of jobs (excluding not found jobs)
     */
    public function getJobs(array $jobIds): array
    {
        $jobs = [];
        
        foreach ($jobIds as $jobId) {
            $job = $this->getJob($jobId);
            if ($job !== null) {
                $jobs[] = $job;
            }
        }

        return $jobs;
    }

    /**
     * Get jobs by type/state.
     *
     * @param string|array<string> $types Job states (waiting, active, delayed, completed, failed)
     * @param int $start Start index
     * @param int $end End index
     * @param bool $asc Sort order (true for ascending)
     * @return array<Job>
     */
    public function getJobsByType(string|array $types, int $start = 0, int $end = -1, bool $asc = false): array
    {
        if (is_string($types)) {
            $types = [$types];
        }

        $jobIds = $this->scripts->getRanges($types, $start, $end, $asc);
        
        return $this->getJobs($jobIds);
    }

    /**
     * Get waiting jobs.
     *
     * @param int $start Start index
     * @param int $end End index
     * @return array<Job>
     */
    public function getWaiting(int $start = 0, int $end = -1): array
    {
        return $this->getJobsByType('waiting', $start, $end);
    }

    /**
     * Get active jobs.
     *
     * @param int $start Start index
     * @param int $end End index
     * @return array<Job>
     */
    public function getActive(int $start = 0, int $end = -1): array
    {
        return $this->getJobsByType('active', $start, $end);
    }

    /**
     * Get delayed jobs.
     *
     * @param int $start Start index
     * @param int $end End index
     * @return array<Job>
     */
    public function getDelayed(int $start = 0, int $end = -1): array
    {
        return $this->getJobsByType('delayed', $start, $end);
    }

    /**
     * Get prioritized jobs.
     *
     * @param int $start Start index
     * @param int $end End index
     * @return array<Job>
     */
    public function getPrioritized(int $start = 0, int $end = -1): array
    {
        return $this->getJobsByType('prioritized', $start, $end);
    }

    /**
     * Get completed jobs.
     *
     * @param int $start Start index
     * @param int $end End index
     * @return array<Job>
     */
    public function getCompleted(int $start = 0, int $end = -1): array
    {
        return $this->getJobsByType('completed', $start, $end);
    }

    /**
     * Get failed jobs.
     *
     * @param int $start Start index
     * @param int $end End index
     * @return array<Job>
     */
    public function getFailed(int $start = 0, int $end = -1): array
    {
        return $this->getJobsByType('failed', $start, $end);
    }

    /**
     * Get the state of a job.
     *
     * @param string $jobId The job ID
     * @return string The job state (waiting, active, delayed, completed, failed, unknown)
     */
    public function getJobState(string $jobId): string
    {
        return $this->scripts->getState($jobId);
    }

    /**
     * Remove a job from the queue.
     *
     * @param string $jobId The job ID to remove
     * @param bool $removeChildren Whether to also remove child jobs
     * @return bool True if the job was removed
     */
    public function remove(string $jobId, bool $removeChildren = true): bool
    {
        $result = $this->scripts->remove($jobId, $removeChildren);
        return $result !== false && $result !== 0;
    }

    /**
     * Clean jobs from a set by state.
     *
     * @param int $grace Grace period in milliseconds
     * @param int $limit Maximum number of jobs to clean (0 for unlimited)
     * @param string $type Job state to clean (completed, failed, delayed, waiting, active)
     * @return array<string> Array of job IDs that were removed
     */
    public function clean(int $grace, int $limit = 0, string $type = 'completed'): array
    {
        return $this->scripts->cleanJobsInSet($type, $grace, $limit);
    }

    /**
     * Drain the queue (remove all waiting and delayed jobs).
     *
     * @param bool $delayed Whether to also drain delayed jobs
     * @return void
     */
    public function drain(bool $delayed = false): void
    {
        // We need to pause first, then clean
        $this->pause();
        
        try {
            // Clean all waiting jobs
            $this->clean(0, 0, 'waiting');
            
            if ($delayed) {
                $this->clean(0, 0, 'delayed');
            }
        } finally {
            $this->resume();
        }
    }

    /**
     * Obliterate (completely destroy) the queue.
     *
     * This removes ALL data associated with the queue including jobs, logs, etc.
     * Use with caution!
     *
     * @param array{force?: bool, count?: int} $opts Options
     *   - force: Force obliteration even with active jobs
     *   - count: Maximum jobs to remove per iteration (default 1000)
     * @return void
     */
    public function obliterate(array $opts = []): void
    {
        $force = $opts['force'] ?? false;
        $count = $opts['count'] ?? 1000;

        // First pause the queue
        $this->pause();

        // Keep iterating until fully obliterated
        while (true) {
            $cursor = $this->scripts->obliterate($count, $force);
            if ($cursor === 0) {
                break;
            }
        }
    }

    /**
     * Retry all failed or completed jobs.
     *
     * @param array{count?: int, state?: string, timestamp?: int} $opts Options:
     *   - count: Maximum number of jobs to retry per iteration (default: 1000)
     *   - state: 'failed' or 'completed' (default: 'failed')
     *   - timestamp: Only retry jobs before this timestamp in ms (default: now)
     * @return void
     */
    public function retryJobs(array $opts = []): void
    {
        $count = $opts['count'] ?? 1000;
        $state = $opts['state'] ?? 'failed';
        $timestamp = $opts['timestamp'] ?? (int)(microtime(true) * 1000);

        do {
            $cursor = $this->scripts->moveJobsToWait($state, $count, $timestamp);
        } while ($cursor > 0);
    }

    /**
     * Promote all delayed jobs to waiting.
     *
     * @param array{count?: int} $opts Options:
     *   - count: Maximum number of jobs to promote per iteration (default: 1000)
     * @return void
     */
    public function promoteJobs(array $opts = []): void
    {
        $count = $opts['count'] ?? 1000;
        // Use max timestamp to promote all delayed jobs regardless of scheduled time
        $maxTimestamp = PHP_INT_MAX;

        do {
            $cursor = $this->scripts->moveJobsToWait('delayed', $count, $maxTimestamp);
        } while ($cursor > 0);
    }

    /**
     * Check if the queue is maxed (rate limited).
     *
     * @return bool True if the queue is maxed
     */
    public function isMaxed(): bool
    {
        return $this->scripts->isMaxed();
    }

    /**
     * Get rate limit TTL.
     *
     * @param int|null $maxJobs Maximum jobs to consider
     * @return int TTL in milliseconds
     */
    public function getRateLimitTtl(?int $maxJobs = null): int
    {
        return $this->scripts->getRateLimitTtl($maxJobs);
    }

    /**
     * Close the queue connection.
     *
     * @return void
     */
    public function close(): void
    {
        if ($this->ownsConnection) {
            $this->connection->close();
        }
    }

    /**
     * Generate a unique job ID.
     */
    private function generateJobId(): string
    {
        return Uuid::uuid4()->toString();
    }

    /**
     * Destructor - clean up resources.
     */
    public function __destruct()
    {
        $this->close();
    }
}
