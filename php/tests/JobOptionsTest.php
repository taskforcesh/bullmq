<?php

declare(strict_types=1);

namespace BullMQ\Tests;

use BullMQ\JobOptions;
use PHPUnit\Framework\TestCase;

class JobOptionsTest extends TestCase
{
    public function testCanCreateFromArray(): void
    {
        $options = JobOptions::fromArray([
            'jobId' => 'test-id',
            'delay' => 1000,
            'priority' => 5,
            'attempts' => 3,
        ]);

        $this->assertEquals('test-id', $options->jobId);
        $this->assertEquals(1000, $options->delay);
        $this->assertEquals(5, $options->priority);
        $this->assertEquals(3, $options->attempts);
    }

    public function testCanConvertToArray(): void
    {
        $options = new JobOptions();
        $options->jobId = 'test-id';
        $options->delay = 1000;
        $options->priority = 5;

        $array = $options->toArray();

        $this->assertArrayHasKey('jobId', $array);
        $this->assertArrayHasKey('delay', $array);
        $this->assertArrayHasKey('priority', $array);
        $this->assertEquals('test-id', $array['jobId']);
        $this->assertEquals(1000, $array['delay']);
        $this->assertEquals(5, $array['priority']);
    }

    public function testDefaultValues(): void
    {
        $options = new JobOptions();

        $this->assertNull($options->jobId);
        $this->assertEquals(0, $options->delay);
        $this->assertEquals(0, $options->attempts);
        $this->assertNull($options->priority);
        $this->assertFalse($options->lifo);
    }

    public function testDeduplicationRescheduleIsPreserved(): void
    {
        foreach ([true, false] as $reschedule) {
            $deduplication = ['id' => 'reschedule', 'reschedule' => $reschedule];
            $options = JobOptions::fromArray(['deduplication' => $deduplication]);

            $this->assertSame($deduplication, $options->deduplication);
            $this->assertSame($deduplication, $options->toArray()['de']);
        }
    }

    public function testBackoffNormalization(): void
    {
        // Integer backoff
        $options = JobOptions::fromArray([
            'backoff' => 1000,
        ]);

        $array = $options->toArray();
        $this->assertEquals(['type' => 'fixed', 'delay' => 1000], $array['backoff']);

        // Array backoff
        $options2 = JobOptions::fromArray([
            'backoff' => ['type' => 'exponential', 'delay' => 2000],
        ]);

        $array2 = $options2->toArray();
        $this->assertEquals(['type' => 'exponential', 'delay' => 2000], $array2['backoff']);
    }

    public function testRemoveOnCompleteOptions(): void
    {
        // Boolean
        $options = JobOptions::fromArray(['removeOnComplete' => true]);
        $this->assertTrue($options->removeOnComplete);

        // Integer
        $options = JobOptions::fromArray(['removeOnComplete' => 100]);
        $this->assertEquals(100, $options->removeOnComplete);

        // Array
        $options = JobOptions::fromArray(['removeOnComplete' => ['age' => 3600, 'count' => 100]]);
        $this->assertEquals(['age' => 3600, 'count' => 100], $options->removeOnComplete);
    }

    public function testParentConfiguration(): void
    {
        $options = JobOptions::fromArray([
            'parent' => ['id' => 'parent-id', 'queue' => 'parent-queue'],
        ]);

        $this->assertEquals(['id' => 'parent-id', 'queue' => 'parent-queue'], $options->parent);

        $array = $options->toArray();
        $this->assertArrayHasKey('parent', $array);
    }

    public function testParentFailureOptionsMapToShortKeys(): void
    {
        $options = JobOptions::fromArray([
            'failParentOnFailure' => true,
            'continueParentOnFailure' => true,
            'ignoreDependencyOnFailure' => true,
            'removeDependencyOnFailure' => true,
        ]);

        $array = $options->toArray();
        $this->assertTrue($array['fpof']);
        $this->assertTrue($array['cpof']);
        $this->assertTrue($array['idof']);
        $this->assertTrue($array['rdof']);
    }

    public function testRemoveDependencyOnFailureMapsToRdofNotIdof(): void
    {
        $array = JobOptions::fromArray(['removeDependencyOnFailure' => true])->toArray();

        $this->assertTrue($array['rdof']);
        $this->assertArrayNotHasKey('idof', $array);
    }

    public function testIgnoreDependencyOnFailureMapsToIdof(): void
    {
        $array = JobOptions::fromArray(['ignoreDependencyOnFailure' => true])->toArray();

        $this->assertTrue($array['idof']);
        $this->assertArrayNotHasKey('rdof', $array);
    }
    public function testStoredOptionsRoundTrip(): void
    {
        $options = JobOptions::fromArray([
            'failParentOnFailure' => true,
            'continueParentOnFailure' => true,
            'ignoreDependencyOnFailure' => true,
            'removeDependencyOnFailure' => true,
            'keepLogs' => 5,
            'deduplication' => ['id' => 'd'],
        ]);

        // As stored in Redis (short names), then read back
        $stored = json_decode(json_encode($options->toArray()), true);
        $readBack = JobOptions::fromArray($stored);

        $this->assertTrue($readBack->failParentOnFailure);
        $this->assertTrue($readBack->continueParentOnFailure);
        $this->assertTrue($readBack->ignoreDependencyOnFailure);
        $this->assertTrue($readBack->removeDependencyOnFailure);
        $this->assertSame(5, $readBack->keepLogs);
        $this->assertSame(['id' => 'd'], $readBack->deduplication);
        $this->assertEquals($options->toArray(), $readBack->toArray());
    }

    public function testLongNamesWinOverStoredOnes(): void
    {
        $options = JobOptions::fromArray(['keepLogs' => 3, 'kl' => 9]);

        $this->assertSame(3, $options->keepLogs);
    }
}
