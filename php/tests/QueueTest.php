<?php

declare(strict_types=1);

namespace BullMQ\Tests;

use BullMQ\Queue;
use BullMQ\Job;
use BullMQ\RedisConnection;
use PHPUnit\Framework\TestCase;

/**
 * Integration tests for Queue class.
 * Requires a running Redis server.
 */
class QueueTest extends TestCase
{
    private ?Queue $queue = null;
    private string $queueName;

    protected function setUp(): void
    {
        $this->queueName = 'test-queue-' . uniqid();
        
        try {
            $this->queue = new Queue($this->queueName, [
                'connection' => [
                    'host' => getenv('REDIS_HOST') ?: 'localhost',
                    'port' => (int)(getenv('REDIS_PORT') ?: 6379),
                ],
            ]);
            // Test connection by pinging
            $this->queue->getConnection()->getClient()->ping();
        } catch (\Exception $e) {
            $this->markTestSkipped('Redis server not available: ' . $e->getMessage());
        }
    }

    protected function tearDown(): void
    {
        if ($this->queue !== null) {
            try {
                $this->queue->obliterate(['force' => true]);
            } catch (\Exception $e) {
                // Ignore cleanup errors
            }
            $this->queue->close();
        }
    }

    public function testCanCreateQueue(): void
    {
        $this->assertInstanceOf(Queue::class, $this->queue);
        $this->assertEquals($this->queueName, $this->queue->name);
    }

    public function testCanAddJob(): void
    {
        $job = $this->queue->add('test-job', ['foo' => 'bar']);

        $this->assertInstanceOf(Job::class, $job);
        $this->assertNotNull($job->id);
        $this->assertEquals('test-job', $job->name);
        $this->assertEquals(['foo' => 'bar'], $job->data);
    }

    public function testCanAddJobWithCustomId(): void
    {
        $job = $this->queue->add('test-job', ['foo' => 'bar'], [
            'jobId' => 'custom-id-123',
        ]);

        $this->assertEquals('custom-id-123', $job->id);
    }

    public function testCanAddDelayedJob(): void
    {
        $job = $this->queue->add('delayed-job', ['foo' => 'bar'], [
            'delay' => 60000, // 60 seconds
        ]);

        $this->assertInstanceOf(Job::class, $job);
        $state = $this->queue->getJobState($job->id);
        $this->assertEquals('delayed', $state);
    }

    public function testCanAddPrioritizedJob(): void
    {
        $job = $this->queue->add('priority-job', ['foo' => 'bar'], [
            'priority' => 1,
        ]);

        $this->assertInstanceOf(Job::class, $job);
        $state = $this->queue->getJobState($job->id);
        $this->assertContains($state, ['waiting', 'prioritized']);
    }

    public function testCanGetJob(): void
    {
        $job = $this->queue->add('test-job', ['foo' => 'bar']);
        
        $retrieved = $this->queue->getJob($job->id);

        $this->assertNotNull($retrieved);
        $this->assertEquals($job->id, $retrieved->id);
        $this->assertEquals($job->name, $retrieved->name);
        $this->assertEquals($job->data, $retrieved->data);
    }

    public function testGetJobReturnsNullForNonexistent(): void
    {
        $retrieved = $this->queue->getJob('nonexistent-id');

        $this->assertNull($retrieved);
    }

    public function testCanGetJobCounts(): void
    {
        // Add some jobs
        $this->queue->add('job-1', ['data' => 1]);
        $this->queue->add('job-2', ['data' => 2]);
        $this->queue->add('job-3', ['data' => 3], ['delay' => 60000]);

        $counts = $this->queue->getJobCounts();

        $this->assertArrayHasKey('waiting', $counts);
        $this->assertArrayHasKey('delayed', $counts);
        $this->assertGreaterThanOrEqual(2, $counts['waiting']);
        $this->assertGreaterThanOrEqual(1, $counts['delayed']);
    }

    public function testCanGetJobCountByTypes(): void
    {
        $this->queue->add('job-1', ['data' => 1]);
        $this->queue->add('job-2', ['data' => 2]);

        $count = $this->queue->getJobCountByTypes('waiting');

        $this->assertGreaterThanOrEqual(2, $count);
    }

    public function testCanPauseAndResumeQueue(): void
    {
        $this->assertFalse($this->queue->isPaused());

        $this->queue->pause();
        $this->assertTrue($this->queue->isPaused());

        $this->queue->resume();
        $this->assertFalse($this->queue->isPaused());
    }

    public function testCanRemoveJob(): void
    {
        $job = $this->queue->add('test-job', ['foo' => 'bar']);
        
        $removed = $this->queue->remove($job->id);

        $this->assertTrue($removed);
        $this->assertNull($this->queue->getJob($job->id));
    }

    public function testCanAddBulkJobs(): void
    {
        $jobs = $this->queue->addBulk([
            ['name' => 'bulk-job-1', 'data' => ['id' => 1]],
            ['name' => 'bulk-job-2', 'data' => ['id' => 2]],
            ['name' => 'bulk-job-3', 'data' => ['id' => 3]],
        ]);

        $this->assertCount(3, $jobs);
        foreach ($jobs as $job) {
            $this->assertInstanceOf(Job::class, $job);
            $this->assertNotNull($job->id);
        }
    }

    public function testCanGetWaitingJobs(): void
    {
        $this->queue->add('job-1', ['data' => 1]);
        $this->queue->add('job-2', ['data' => 2]);

        $waitingJobs = $this->queue->getWaiting();

        $this->assertGreaterThanOrEqual(2, count($waitingJobs));
        foreach ($waitingJobs as $job) {
            $this->assertInstanceOf(Job::class, $job);
        }
    }

    public function testCanGetDelayedJobs(): void
    {
        $this->queue->add('delayed-1', ['data' => 1], ['delay' => 60000]);
        $this->queue->add('delayed-2', ['data' => 2], ['delay' => 120000]);

        $delayedJobs = $this->queue->getDelayed();

        $this->assertGreaterThanOrEqual(2, count($delayedJobs));
    }

    public function testCanGetPrioritizedJobs(): void
    {
        $this->queue->add('priority-1', ['data' => 1], ['priority' => 1]);
        $this->queue->add('priority-2', ['data' => 2], ['priority' => 2]);
        $this->queue->add('priority-3', ['data' => 3], ['priority' => 3]);

        $prioritizedJobs = $this->queue->getPrioritized();

        $this->assertGreaterThanOrEqual(3, count($prioritizedJobs));
        foreach ($prioritizedJobs as $job) {
            $this->assertInstanceOf(Job::class, $job);
        }
    }

    public function testCanCleanJobs(): void
    {
        // This test would require jobs to be completed/failed first
        // which requires a worker. For now, just verify the method exists.
        $cleaned = $this->queue->clean(0, 0, 'completed');
        
        $this->assertIsArray($cleaned);
    }

    public function testCanGetCountsPerPriority(): void
    {
        // Add jobs with different priorities
        for ($i = 0; $i < 12; $i++) {
            $this->queue->add('priority-job', ['idx' => $i], [
                'priority' => $i % 4,
            ]);
        }

        $counts = $this->queue->getCountsPerPriority([0, 1, 2, 3]);

        $this->assertArrayHasKey(0, $counts);
        $this->assertArrayHasKey(1, $counts);
        $this->assertArrayHasKey(2, $counts);
        $this->assertArrayHasKey(3, $counts);
        $this->assertEquals(3, $counts[0]);
        $this->assertEquals(3, $counts[1]);
        $this->assertEquals(3, $counts[2]);
        $this->assertEquals(3, $counts[3]);
    }

    public function testCanPromoteDelayedJobs(): void
    {
        // Add delayed jobs
        $this->queue->add('delayed-1', ['data' => 1], ['delay' => 60000]);
        $this->queue->add('delayed-2', ['data' => 2], ['delay' => 60000]);
        $this->queue->add('delayed-3', ['data' => 3], ['delay' => 60000]);

        $counts = $this->queue->getJobCounts();
        $this->assertEquals(3, $counts['delayed']);

        // Promote all delayed jobs
        $this->queue->promoteJobs();

        // Check they moved to waiting
        $counts = $this->queue->getJobCounts();
        $this->assertEquals(0, $counts['delayed']);
        $this->assertGreaterThanOrEqual(3, $counts['waiting']);
    }

    public function testCanObliterateQueue(): void
    {
        // Add some jobs
        $this->queue->add('job-1', ['data' => 1]);
        $this->queue->add('job-2', ['data' => 2]);
        $this->queue->add('job-3', ['data' => 3], ['delay' => 60000]);

        // Verify jobs exist
        $counts = $this->queue->getJobCounts();
        $this->assertGreaterThan(0, $counts['waiting'] + $counts['delayed']);

        // Obliterate the queue
        $this->queue->obliterate(['force' => true]);

        // Verify queue is empty
        $counts = $this->queue->getJobCounts();
        $this->assertEquals(0, $counts['waiting']);
        $this->assertEquals(0, $counts['delayed']);
    }

    public function testJobWithAttemptsOption(): void
    {
        $job = $this->queue->add('retry-job', ['foo' => 'bar'], [
            'attempts' => 5,
        ]);

        $this->assertEquals(5, $job->opts->attempts);
    }

    public function testJobWithBackoffOption(): void
    {
        $job = $this->queue->add('backoff-job', ['foo' => 'bar'], [
            'attempts' => 3,
            'backoff' => [
                'type' => 'exponential',
                'delay' => 1000,
            ],
        ]);

        $this->assertEquals(3, $job->opts->attempts);
        $this->assertEquals('exponential', $job->opts->backoff['type']);
        $this->assertEquals(1000, $job->opts->backoff['delay']);
    }

    public function testJobWithRemoveOnCompleteOption(): void
    {
        $job = $this->queue->add('removable-job', ['foo' => 'bar'], [
            'removeOnComplete' => true,
        ]);

        $this->assertTrue($job->opts->removeOnComplete);

        // Test with count
        $job2 = $this->queue->add('removable-job-2', ['foo' => 'bar'], [
            'removeOnComplete' => 100,
        ]);

        $this->assertEquals(100, $job2->opts->removeOnComplete);
    }

    public function testCanUseCustomPrefix(): void
    {
        $customQueue = new Queue('custom-prefix-queue', [
            'prefix' => 'myapp',
            'connection' => [
                'host' => getenv('REDIS_HOST') ?: 'localhost',
                'port' => (int)(getenv('REDIS_PORT') ?: 6379),
            ],
        ]);

        $job = $customQueue->add('test-job', ['foo' => 'bar']);
        $this->assertNotNull($job->id);

        // Verify qualified name uses custom prefix
        $qualifiedName = $customQueue->getQualifiedName();
        $this->assertStringStartsWith('myapp:', $qualifiedName);

        $customQueue->obliterate(['force' => true]);
        $customQueue->close();
    }

    public function testCanShareConnection(): void
    {
        $connection = new RedisConnection([
            'host' => getenv('REDIS_HOST') ?: 'localhost',
            'port' => (int)(getenv('REDIS_PORT') ?: 6379),
        ]);

        $queue1 = new Queue('shared-conn-queue-1', ['connection' => $connection]);
        $queue2 = new Queue('shared-conn-queue-2', ['connection' => $connection]);

        $job1 = $queue1->add('job-1', ['queue' => 1]);
        $job2 = $queue2->add('job-2', ['queue' => 2]);

        $this->assertNotNull($job1->id);
        $this->assertNotNull($job2->id);

        $queue1->obliterate(['force' => true]);
        $queue2->obliterate(['force' => true]);

        // Queues don't own the connection, so they shouldn't close it
        $queue1->close();
        $queue2->close();

        // Connection should still be usable
        $result = $connection->getClient()->ping();
        $this->assertNotNull($result);

        $connection->close();
    }

    public function testGetJobsByMultipleTypes(): void
    {
        $this->queue->add('waiting-job', ['type' => 'waiting']);
        $this->queue->add('delayed-job', ['type' => 'delayed'], ['delay' => 60000]);

        // Get jobs from multiple types at once
        $jobs = $this->queue->getJobsByType(['waiting', 'delayed']);

        $this->assertGreaterThanOrEqual(2, count($jobs));
    }

    public function testJobDataIntegrity(): void
    {
        $complexData = [
            'string' => 'hello world',
            'number' => 42,
            'float' => 3.14159,
            'boolean' => true,
            'null' => null,
            'array' => [1, 2, 3],
            'nested' => [
                'foo' => 'bar',
                'baz' => [1, 2, 3],
            ],
            'unicode' => '你好世界 🌍',
        ];

        $job = $this->queue->add('complex-data-job', $complexData);
        $retrieved = $this->queue->getJob($job->id);

        $this->assertEquals($complexData['string'], $retrieved->data['string']);
        $this->assertEquals($complexData['number'], $retrieved->data['number']);
        $this->assertEquals($complexData['float'], $retrieved->data['float']);
        $this->assertEquals($complexData['boolean'], $retrieved->data['boolean']);
        $this->assertNull($retrieved->data['null']);
        $this->assertEquals($complexData['array'], $retrieved->data['array']);
        $this->assertEquals($complexData['nested'], $retrieved->data['nested']);
        $this->assertEquals($complexData['unicode'], $retrieved->data['unicode']);
    }
}
