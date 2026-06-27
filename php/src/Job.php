<?php

declare(strict_types=1);

namespace BullMQ;

use Ramsey\Uuid\Uuid;

/**
 * Represents a job in the queue.
 *
 * Jobs are the basic unit of work in BullMQ. They contain data that workers
 * process and metadata about how the job should be handled.
 */
class Job
{
    /**
     * The unique identifier for this job.
     */
    public ?string $id = null;

    /**
     * The name of the job.
     */
    public string $name;

    /**
     * The data payload for this job.
     *
     * @var mixed
     */
    public mixed $data;

    /**
     * The options for this job.
     */
    public JobOptions $opts;

    /**
     * Job progress (0-100 or custom value).
     *
     * @var int|float|array<mixed>
     */
    public int|float|array $progress = 0;

    /**
     * The timestamp when the job was created.
     */
    public int $timestamp;

    /**
     * Number of attempts made to process this job.
     */
    public int $attemptsMade = 0;

    /**
     * The delay in milliseconds before processing.
     */
    public int $delay = 0;

    /**
     * Return value from job processing.
     *
     * @var mixed
     */
    public mixed $returnvalue = null;

    /**
     * The reason the job failed, if applicable.
     */
    public ?string $failedReason = null;

    /**
     * Stack trace from job failure.
     *
     * @var array<string>
     */
    public array $stacktrace = [];

    /**
     * Timestamp when processing started.
     */
    public ?int $processedOn = null;

    /**
     * Timestamp when job finished.
     */
    public ?int $finishedOn = null;

    /**
     * Parent job key.
     */
    public ?string $parentKey = null;

    /**
     * Parent job info.
     *
     * @var array{id: string, queueKey: string}|null
     */
    public ?array $parent = null;

    /**
     * Reference to the queue this job belongs to.
     */
    private Queue $queue;

    /**
     * Create a new Job instance.
     *
     * @param Queue $queue The queue this job belongs to
     * @param string $name The name of the job
     * @param mixed $data The job data
     * @param JobOptions|array<string, mixed> $opts Job options
     */
    public function __construct(
        Queue $queue,
        string $name,
        mixed $data,
        JobOptions|array $opts = []
    ) {
        $this->queue = $queue;
        $this->name = $name;
        $this->data = $data;

        if (is_array($opts)) {
            $this->opts = JobOptions::fromArray($opts);
        } else {
            $this->opts = $opts;
        }

        $this->id = $this->opts->jobId;
        $this->timestamp = $this->opts->timestamp ?? (int)(microtime(true) * 1000);
        $this->delay = $this->opts->delay;

        // Handle parent relationship
        $parent = $this->opts->parent;
        if ($parent !== null) {
            $this->parentKey = $this->getParentKey($parent);
            $this->parent = [
                'id' => $parent['id'],
                'queueKey' => $parent['queue'],
            ];
        }
    }

    /**
     * Get the parent key from parent options.
     *
     * @param array{id: string, queue: string}|null $parent
     */
    private function getParentKey(?array $parent): ?string
    {
        if ($parent === null) {
            return null;
        }

        return "{$parent['queue']}:{$parent['id']}";
    }

    /**
     * Get the queue this job belongs to.
     */
    public function getQueue(): Queue
    {
        return $this->queue;
    }

    /**
     * Create a job from raw Redis data.
     *
     * @param Queue $queue
     * @param array<string, mixed> $rawData
     * @param string $jobId
     * @return self
     */
    public static function fromRaw(Queue $queue, array $rawData, string $jobId): self
    {
        $data = isset($rawData['data']) ? json_decode($rawData['data'], true) : null;
        $name = $rawData['name'] ?? 'unknown';
        
        $opts = [];
        if (isset($rawData['opts'])) {
            $decodedOpts = json_decode($rawData['opts'], true);
            if (is_array($decodedOpts)) {
                $opts = $decodedOpts;
            }
        }

        $job = new self($queue, $name, $data, $opts);
        $job->id = $jobId;

        if (isset($rawData['timestamp'])) {
            $job->timestamp = (int) $rawData['timestamp'];
        }
        if (isset($rawData['delay'])) {
            $job->delay = (int) $rawData['delay'];
        }
        if (isset($rawData['progress'])) {
            $progress = json_decode($rawData['progress'], true);
            $job->progress = $progress ?? (int) $rawData['progress'];
        }
        if (isset($rawData['attemptsMade'])) {
            $job->attemptsMade = (int) $rawData['attemptsMade'];
        }
        if (isset($rawData['returnvalue'])) {
            $job->returnvalue = json_decode($rawData['returnvalue'], true);
        }
        if (isset($rawData['failedReason'])) {
            $job->failedReason = $rawData['failedReason'];
        }
        if (isset($rawData['stacktrace'])) {
            $stacktrace = json_decode($rawData['stacktrace'], true);
            $job->stacktrace = is_array($stacktrace) ? $stacktrace : [];
        }
        if (isset($rawData['processedOn'])) {
            $job->processedOn = (int) $rawData['processedOn'];
        }
        if (isset($rawData['finishedOn'])) {
            $job->finishedOn = (int) $rawData['finishedOn'];
        }
        if (isset($rawData['parentKey'])) {
            $job->parentKey = $rawData['parentKey'];
        }
        if (isset($rawData['parent'])) {
            $parent = json_decode($rawData['parent'], true);
            if (is_array($parent)) {
                $job->parent = $parent;
            }
        }

        return $job;
    }

    /**
     * Convert job to JSON representation.
     *
     * @return array<string, mixed>
     */
    public function toJson(): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'data' => $this->data,
            'opts' => $this->opts->toArray(),
            'progress' => $this->progress,
            'timestamp' => $this->timestamp,
            'delay' => $this->delay,
            'attemptsMade' => $this->attemptsMade,
            'returnvalue' => $this->returnvalue,
            'failedReason' => $this->failedReason,
            'stacktrace' => $this->stacktrace,
            'processedOn' => $this->processedOn,
            'finishedOn' => $this->finishedOn,
            'parentKey' => $this->parentKey,
            'parent' => $this->parent,
        ];
    }
}
