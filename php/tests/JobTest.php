<?php

declare(strict_types=1);

namespace BullMQ\Tests;

use BullMQ\Job;
use BullMQ\JobOptions;
use BullMQ\Queue;
use PHPUnit\Framework\TestCase;

class JobTest extends TestCase
{
    public function testCanCreateJob(): void
    {
        $queue = $this->createMock(Queue::class);
        $job = new Job($queue, 'test-job', ['foo' => 'bar']);

        $this->assertEquals('test-job', $job->name);
        $this->assertEquals(['foo' => 'bar'], $job->data);
        $this->assertInstanceOf(JobOptions::class, $job->opts);
    }

    public function testCanCreateJobWithOptions(): void
    {
        $queue = $this->createMock(Queue::class);
        $job = new Job($queue, 'test-job', ['foo' => 'bar'], [
            'jobId' => 'custom-id',
            'delay' => 1000,
            'priority' => 5,
        ]);

        $this->assertEquals('custom-id', $job->id);
        $this->assertEquals(1000, $job->opts->delay);
        $this->assertEquals(5, $job->opts->priority);
    }

    public function testJobHasTimestamp(): void
    {
        $queue = $this->createMock(Queue::class);
        $before = (int)(microtime(true) * 1000);
        $job = new Job($queue, 'test-job', []);
        $after = (int)(microtime(true) * 1000);

        $this->assertGreaterThanOrEqual($before, $job->timestamp);
        $this->assertLessThanOrEqual($after, $job->timestamp);
    }

    public function testCanConvertJobToJson(): void
    {
        $queue = $this->createMock(Queue::class);
        $job = new Job($queue, 'test-job', ['foo' => 'bar'], [
            'jobId' => 'test-id',
        ]);
        $job->id = 'test-id';

        $json = $job->toJson();

        $this->assertArrayHasKey('id', $json);
        $this->assertArrayHasKey('name', $json);
        $this->assertArrayHasKey('data', $json);
        $this->assertArrayHasKey('opts', $json);
        $this->assertEquals('test-id', $json['id']);
        $this->assertEquals('test-job', $json['name']);
        $this->assertEquals(['foo' => 'bar'], $json['data']);
    }
}
