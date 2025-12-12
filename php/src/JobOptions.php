<?php

declare(strict_types=1);

namespace BullMQ;

/**
 * Job options configuration.
 */
class JobOptions
{
    /**
     * Override the job ID - by default, the job ID is a unique integer.
     */
    public ?string $jobId = null;

    /**
     * Timestamp when the job was created.
     */
    public ?int $timestamp = null;

    /**
     * An amount of milliseconds to wait until this job can be processed.
     */
    public int $delay = 0;

    /**
     * The total number of attempts to try the job until it completes.
     */
    public int $attempts = 0;

    /**
     * Backoff setting for automatic retries if the job fails.
     * Can be an integer (fixed delay in ms) or an array with 'type' and 'delay' keys.
     *
     * @var int|array{type: string, delay: int}|null
     */
    public int|array|null $backoff = null;

    /**
     * If true, removes the job when it successfully completes.
     * When given a number, it specifies the maximum amount of jobs to keep.
     *
     * @var bool|int|array{age?: int, count?: int}
     */
    public bool|int|array $removeOnComplete = false;

    /**
     * If true, removes the job when it fails after all attempts.
     * When given a number, it specifies the maximum amount of jobs to keep.
     *
     * @var bool|int|array{age?: int, count?: int}
     */
    public bool|int|array $removeOnFail = false;

    /**
     * Priority of the job. Lower values have higher priority.
     */
    public ?int $priority = null;

    /**
     * If true, add the job to the right of the queue (LIFO).
     */
    public bool $lifo = false;

    /**
     * Maximum number of stack trace lines to record.
     */
    public ?int $stackTraceLimit = null;

    /**
     * If true, the parent job will fail if this child job fails.
     */
    public bool $failParentOnFailure = false;

    /**
     * If true, the parent job will continue even if this child job fails.
     */
    public bool $continueParentOnFailure = false;

    /**
     * If true, the child will be removed when the parent is removed.
     */
    public bool $removeDependencyOnFailure = false;

    /**
     * Maximum number of logs to keep for this job.
     */
    public ?int $keepLogs = null;

    /**
     * Parent job configuration.
     *
     * @var array{id: string, queue: string}|null
     */
    public ?array $parent = null;

    /**
     * Create JobOptions from an associative array.
     *
     * @param array<string, mixed> $options
     */
    public static function fromArray(array $options): self
    {
        $instance = new self();

        if (isset($options['jobId'])) {
            $instance->jobId = (string) $options['jobId'];
        }
        if (isset($options['timestamp'])) {
            $instance->timestamp = (int) $options['timestamp'];
        }
        if (isset($options['delay'])) {
            $instance->delay = (int) $options['delay'];
        }
        if (isset($options['attempts'])) {
            $instance->attempts = (int) $options['attempts'];
        }
        if (isset($options['backoff'])) {
            $instance->backoff = $options['backoff'];
        }
        if (isset($options['removeOnComplete'])) {
            $instance->removeOnComplete = $options['removeOnComplete'];
        }
        if (isset($options['removeOnFail'])) {
            $instance->removeOnFail = $options['removeOnFail'];
        }
        if (isset($options['priority'])) {
            $instance->priority = (int) $options['priority'];
        }
        if (isset($options['lifo'])) {
            $instance->lifo = (bool) $options['lifo'];
        }
        if (isset($options['stackTraceLimit'])) {
            $instance->stackTraceLimit = (int) $options['stackTraceLimit'];
        }
        if (isset($options['failParentOnFailure'])) {
            $instance->failParentOnFailure = (bool) $options['failParentOnFailure'];
        }
        if (isset($options['continueParentOnFailure'])) {
            $instance->continueParentOnFailure = (bool) $options['continueParentOnFailure'];
        }
        if (isset($options['removeDependencyOnFailure'])) {
            $instance->removeDependencyOnFailure = (bool) $options['removeDependencyOnFailure'];
        }
        if (isset($options['keepLogs'])) {
            $instance->keepLogs = (int) $options['keepLogs'];
        }
        if (isset($options['parent'])) {
            $instance->parent = $options['parent'];
        }

        return $instance;
    }

    /**
     * Convert to an associative array.
     *
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $result = [
            'delay' => $this->delay,
            'attempts' => $this->attempts,
        ];

        if ($this->jobId !== null) {
            $result['jobId'] = $this->jobId;
        }
        if ($this->timestamp !== null) {
            $result['timestamp'] = $this->timestamp;
        }
        if ($this->backoff !== null) {
            $result['backoff'] = $this->normalizeBackoff($this->backoff);
        }
        if ($this->removeOnComplete !== false) {
            $result['removeOnComplete'] = $this->removeOnComplete;
        }
        if ($this->removeOnFail !== false) {
            $result['removeOnFail'] = $this->removeOnFail;
        }
        if ($this->priority !== null) {
            $result['priority'] = $this->priority;
        }
        if ($this->lifo) {
            $result['lifo'] = $this->lifo;
        }
        if ($this->stackTraceLimit !== null) {
            $result['stackTraceLimit'] = $this->stackTraceLimit;
        }
        if ($this->failParentOnFailure) {
            $result['fpof'] = $this->failParentOnFailure;
        }
        if ($this->continueParentOnFailure) {
            $result['cpof'] = $this->continueParentOnFailure;
        }
        if ($this->removeDependencyOnFailure) {
            $result['idof'] = $this->removeDependencyOnFailure;
        }
        if ($this->keepLogs !== null) {
            $result['kl'] = $this->keepLogs;
        }
        if ($this->parent !== null) {
            $result['parent'] = $this->parent;
        }

        return $result;
    }

    /**
     * Normalize backoff settings.
     *
     * @param int|array{type: string, delay: int}|null $backoff
     * @return array{type: string, delay: int}|null
     */
    private function normalizeBackoff(int|array|null $backoff): ?array
    {
        if ($backoff === null) {
            return null;
        }

        if (is_int($backoff)) {
            return ['type' => 'fixed', 'delay' => $backoff];
        }

        return $backoff;
    }
}
