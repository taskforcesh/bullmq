<?php

declare(strict_types=1);

namespace BullMQ;

use MessagePack\Packer;

/**
 * Handles loading and execution of Lua scripts.
 *
 * Scripts are loaded from the commands directory which contains Lua files
 * copied from the rawScripts directory. The script file names follow the
 * pattern: scriptName-numberOfKeys.lua
 */
class Scripts
{
    private string $queueName;
    /** @var \Predis\Client */
    private $client;
    private QueueKeys $queueKeys;
    private Packer $packer;

    /**
     * @var array<string, string>
     */
    private array $keys;

    /**
     * Cached Lua scripts.
     *
     * @var array<string, string>
     */
    private static array $scriptCache = [];

    public function __construct(string $prefix, string $queueName, RedisConnection $redisConnection)
    {
        $this->queueName = $queueName;
        $this->client = $redisConnection->getClient();
        $this->queueKeys = new QueueKeys($prefix);
        $this->keys = $this->queueKeys->getKeys($queueName);
        $this->packer = new Packer();
    }

    /**
     * Get the key for a specific type.
     */
    public function toKey(string $name): string
    {
        return $this->queueKeys->toKey($this->queueName, $name);
    }

    /**
     * Get keys by their names.
     *
     * @param array<string> $keyNames
     * @return array<string>
     */
    public function getKeys(array $keyNames): array
    {
        return array_map(fn($key) => $this->keys[$key], $keyNames);
    }

    /**
     * Load a Lua script by name.
     */
    private function getScript(string $name): string
    {
        if (!isset(self::$scriptCache[$name])) {
            $path = __DIR__ . '/commands/' . $name;
            if (!file_exists($path)) {
                throw new \RuntimeException("Script not found: {$name}");
            }
            self::$scriptCache[$name] = file_get_contents($path);
        }
        return self::$scriptCache[$name];
    }

    /**
     * Execute a Lua script.
     *
     * @param string $scriptName
     * @param array<string> $keys
     * @param array<mixed> $args
     * @return mixed
     */
    private function execScript(string $scriptName, array $keys, array $args): mixed
    {
        $script = $this->getScript($scriptName);
        $numKeys = count($keys);
        
        return $this->client->eval($script, $numKeys, ...$keys, ...$args);
    }

    /**
     * Queue a Lua script execution on a transaction.
     *
     * @param mixed $transaction The Predis transaction
     * @param string $scriptName
     * @param array<string> $keys
     * @param array<mixed> $args
     * @return void
     */
    private function execScriptOnTransaction(mixed $transaction, string $scriptName, array $keys, array $args): void
    {
        $script = $this->getScript($scriptName);
        $numKeys = count($keys);
        
        $transaction->eval($script, $numKeys, ...$keys, ...$args);
    }

    /**
     * Add a job to a transaction (for bulk operations).
     *
     * @param mixed $transaction The Predis transaction
     * @param Job $job
     * @return void
     */
    public function addJobToTransaction(mixed $transaction, Job $job): void
    {
        if ($job->opts->delay > 0) {
            $this->addDelayedJobToTransaction($transaction, $job, $job->opts->delay);
        } elseif ($job->opts->priority !== null && $job->opts->priority > 0) {
            $this->addPrioritizedJobToTransaction($transaction, $job, $job->opts->priority);
        } else {
            $this->addStandardJobToTransaction($transaction, $job, $job->timestamp);
        }
    }

    /**
     * Add a standard job to a transaction.
     */
    private function addStandardJobToTransaction(mixed $transaction, Job $job, int $timestamp): void
    {
        $keys = $this->getKeys(['wait', 'paused', 'meta', 'id', 'completed', 'delayed', 'active', 'events', 'marker']);
        $args = $this->addJobArgs($job);
        $args[] = $timestamp;

        $this->execScriptOnTransaction($transaction, 'addStandardJob-9.lua', $keys, $args);
    }

    /**
     * Add a delayed job to a transaction.
     */
    private function addDelayedJobToTransaction(mixed $transaction, Job $job, int $delay): void
    {
        $keys = $this->getKeys(['marker', 'meta', 'id', 'delayed', 'completed', 'events']);
        $args = $this->addJobArgs($job);
        $args[] = $job->timestamp + $delay;

        $this->execScriptOnTransaction($transaction, 'addDelayedJob-6.lua', $keys, $args);
    }

    /**
     * Add a prioritized job to a transaction.
     */
    private function addPrioritizedJobToTransaction(mixed $transaction, Job $job, int $priority): void
    {
        $keys = $this->getKeys(['marker', 'meta', 'id', 'prioritized', 'delayed', 'completed', 'active', 'events', 'pc']);
        $args = $this->addJobArgs($job);
        $args[] = $priority;

        $this->execScriptOnTransaction($transaction, 'addPrioritizedJob-9.lua', $keys, $args);
    }

    /**
     * Build the arguments for adding a job.
     *
     * @param Job $job
     * @return array<mixed>
     */
    public function addJobArgs(Job $job): array
    {
        $jsonData = json_encode($job->data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $packedOpts = $this->packer->pack($job->opts->toArray());

        $parent = $job->parent;
        $parentKey = $job->parentKey;

        $packedArgs = $this->packer->pack([
            $this->keys[''],
            $job->id ?? '',
            $job->name,
            $job->timestamp,
            $job->parentKey,
            $parentKey !== null ? "{$parentKey}:dependencies" : null,
            $parent,
        ]);

        return [$packedArgs, $jsonData, $packedOpts];
    }

    /**
     * Add a job to the queue.
     *
     * @param Job $job
     * @return string The job ID
     */
    public function addJob(Job $job): string
    {
        $result = null;

        if ($job->opts->delay > 0) {
            $result = $this->addDelayedJob($job, $job->opts->delay);
        } elseif ($job->opts->priority !== null && $job->opts->priority > 0) {
            $result = $this->addPrioritizedJob($job, $job->opts->priority);
        } else {
            $result = $this->addStandardJob($job, $job->timestamp);
        }

        if (is_int($result) && $result < 0) {
            throw $this->finishedErrors([
                'code' => $result,
                'parentKey' => $job->parentKey,
                'command' => 'addJob',
            ]);
        }

        return (string) $result;
    }

    /**
     * Add a standard job to the queue.
     *
     * @param Job $job
     * @param int $timestamp
     * @return mixed
     */
    public function addStandardJob(Job $job, int $timestamp): mixed
    {
        $keys = $this->getKeys(['wait', 'paused', 'meta', 'id', 'completed', 'delayed', 'active', 'events', 'marker']);
        $args = $this->addJobArgs($job);
        $args[] = $timestamp;

        return $this->execScript('addStandardJob-9.lua', $keys, $args);
    }

    /**
     * Add a delayed job to the queue.
     *
     * @param Job $job
     * @param int $delay
     * @return mixed
     */
    public function addDelayedJob(Job $job, int $delay): mixed
    {
        $keys = $this->getKeys(['marker', 'meta', 'id', 'delayed', 'completed', 'events']);
        $args = $this->addJobArgs($job);
        $args[] = $job->timestamp + $delay;

        return $this->execScript('addDelayedJob-6.lua', $keys, $args);
    }

    /**
     * Add a prioritized job to the queue.
     *
     * @param Job $job
     * @param int $priority
     * @return mixed
     */
    public function addPrioritizedJob(Job $job, int $priority): mixed
    {
        $keys = $this->getKeys(['marker', 'meta', 'id', 'prioritized', 'delayed', 'completed', 'active', 'events', 'pc']);
        $args = $this->addJobArgs($job);
        $args[] = $priority;

        return $this->execScript('addPrioritizedJob-9.lua', $keys, $args);
    }

    /**
     * Pause or resume the queue.
     *
     * @param bool $pause True to pause, false to resume
     * @return mixed
     */
    public function pause(bool $pause = true): mixed
    {
        $src = $pause ? 'wait' : 'paused';
        $dst = $pause ? 'paused' : 'wait';
        $keys = $this->getKeys([$src, $dst, 'meta', 'prioritized', 'events', 'delayed', 'marker']);
        
        return $this->execScript('pause-7.lua', $keys, [$pause ? 'paused' : 'resumed']);
    }

    /**
     * Get job counts by types.
     *
     * @param array<string> $types
     * @return array<int>
     */
    public function getCounts(array $types): array
    {
        $keys = $this->getKeys(['']);
        $transformedTypes = array_map(
            fn($type) => $type === 'waiting' ? 'wait' : $type,
            $types
        );

        $result = $this->execScript('getCounts-1.lua', $keys, $transformedTypes);
        
        return is_array($result) ? $result : [];
    }

    /**
     * Get counts per priority.
     *
     * @param array<int> $priorities
     * @return array<int>
     */
    public function getCountsPerPriority(array $priorities): array
    {
        $keys = [
            $this->keys['wait'],
            $this->keys['paused'],
            $this->keys['meta'],
            $this->keys['prioritized'],
        ];

        $result = $this->execScript('getCountsPerPriority-4.lua', $keys, $priorities);
        
        return is_array($result) ? $result : [];
    }

    /**
     * Get job state.
     *
     * @param string $jobId
     * @return string
     */
    public function getState(string $jobId): string
    {
        $keys = $this->getKeys([
            'completed', 'failed', 'delayed', 'active', 'wait',
            'paused', 'waiting-children', 'prioritized'
        ]);

        $args = [$jobId, $this->toKey($jobId)];

        $result = $this->execScript('getStateV2-8.lua', $keys, $args);
        
        return is_string($result) ? $result : 'unknown';
    }

    /**
     * Get ranges of jobs.
     *
     * @param array<string> $types
     * @param int $start
     * @param int $end
     * @param bool $asc
     * @return array<string>
     */
    public function getRanges(array $types, int $start = 0, int $end = 1, bool $asc = false): array
    {
        $transformedTypes = array_map(
            fn($type) => $type === 'waiting' ? 'wait' : $type,
            $types
        );

        $keys = $this->getKeys(['']);
        $args = [$start, $end, $asc ? '1' : '0', ...$transformedTypes];

        $result = $this->execScript('getRanges-1.lua', $keys, $args);
        
        if (!is_array($result)) {
            return [];
        }

        // Flatten the results
        $jobIds = [];
        foreach ($result as $response) {
            if (is_array($response)) {
                $jobIds = array_merge($jobIds, $response);
            }
        }

        return array_unique($jobIds);
    }

    /**
     * Clean jobs from a set.
     *
     * @param string $type
     * @param int $grace Time in milliseconds
     * @param int $limit Maximum number of jobs to clean
     * @return array<string> Job IDs that were cleaned
     */
    public function cleanJobsInSet(string $type, int $grace = 0, int $limit = 0): array
    {
        $keys = [
            $this->toKey($type),
            $this->keys['events'],
            $this->keys['repeat'],
        ];
        
        $args = [
            $this->keys[''],
            (int)(microtime(true) * 1000) - $grace,
            $limit,
            $type,
        ];

        $result = $this->execScript('cleanJobsInSet-3.lua', $keys, $args);
        
        return is_array($result) ? $result : [];
    }

    /**
     * Obliterate (completely destroy) the queue.
     *
     * @param int $count Maximum number of jobs to remove per iteration
     * @param bool $force Force obliteration even with active jobs
     * @return int Cursor position, 0 when complete
     */
    public function obliterate(int $count, bool $force = false): int
    {
        $keys = $this->getKeys(['meta', '']);
        $result = $this->execScript('obliterate-2.lua', $keys, [$count, $force ? 1 : '']);

        if (is_int($result) && $result < 0) {
            if ($result === -1) {
                throw new \RuntimeException('Cannot obliterate non-paused queue');
            }
            if ($result === -2) {
                throw new \RuntimeException('Cannot obliterate queue with active jobs');
            }
        }

        return (int) $result;
    }

    /**
     * Move jobs to wait state (for retrying).
     *
     * @param string $state Source state
     * @param int $count Number of jobs to move
     * @param int $timestamp Timestamp filter
     * @return int Cursor position
     */
    public function moveJobsToWait(string $state, int $count, int $timestamp): int
    {
        $keys = $this->getKeys(['', 'events', $state, 'wait', 'paused', 'meta', 'active', 'marker']);
        $args = [$count, $timestamp, $state];

        $result = $this->execScript('moveJobsToWait-8.lua', $keys, $args);
        
        return (int) $result;
    }

    /**
     * Remove a job.
     *
     * @param string $jobId
     * @param bool $removeChildren
     * @return mixed
     */
    public function remove(string $jobId, bool $removeChildren = true): mixed
    {
        $keys = [
            $this->toKey($jobId),
            $this->keys['repeat'],
        ];
        $args = [$jobId, $removeChildren ? 1 : 0, $this->keys['']];

        return $this->execScript('removeJob-2.lua', $keys, $args);
    }

    /**
     * Check if queue is maxed (rate limited).
     *
     * @return bool
     */
    public function isMaxed(): bool
    {
        $keys = [$this->keys['meta'], $this->keys['active']];
        $result = $this->execScript('isMaxed-2.lua', $keys, []);
        
        return (bool) $result;
    }

    /**
     * Get rate limit TTL.
     *
     * @param int|null $maxJobs
     * @return int TTL in milliseconds, -2 if key doesn't exist, -1 if no expire
     */
    public function getRateLimitTtl(?int $maxJobs = null): int
    {
        $keys = [$this->keys['meta'], $this->keys['limiter']];
        $args = $maxJobs !== null ? [$maxJobs] : [];

        $result = $this->execScript('getRateLimitTtl-2.lua', $keys, $args);
        
        return (int) $result;
    }

    /**
     * Create an exception from an error code.
     *
     * @param array{code: int, parentKey?: ?string, jobId?: string, command: string, state?: string} $options
     * @return \RuntimeException
     */
    private function finishedErrors(array $options): \RuntimeException
    {
        $code = $options['code'];
        $command = $options['command'];
        $jobId = $options['jobId'] ?? null;
        $parentKey = $options['parentKey'] ?? null;
        $state = $options['state'] ?? null;

        $message = match ($code) {
            -1 => "Missing key for job {$jobId}. {$command}",
            -2 => "Missing lock for job {$jobId}. {$command}",
            -3 => "Job is not in the {$state} state. {$jobId}. {$command}",
            -4 => "Job {$jobId} has pending dependencies. {$command}",
            -5 => "Parent job {$parentKey} not found",
            -6 => "Lock mismatch for job {$jobId}. Cmd {$command} from {$state}",
            default => "Unknown error code {$code}. {$command}",
        };

        return new \RuntimeException($message, $code);
    }
}
