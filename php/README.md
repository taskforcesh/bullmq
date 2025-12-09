# BullMQ PHP

A PHP client library for [BullMQ](https://bullmq.io), the modern queue system for Node.js.

This library allows you to add jobs to a BullMQ queue from your PHP application. The jobs can then be processed by workers written in Node.js, Python, or Elixir.

## Requirements

- PHP 8.1 or higher
- Redis 5.0 or higher (6.2+ recommended)
- Composer

## Installation

This package is distributed directly from the BullMQ monorepo. Add the repository to your `composer.json` and require the package:

```json
{
  "repositories": [
    {
      "type": "vcs",
      "url": "https://github.com/taskforcesh/bullmq"
    }
  ],
  "require": {
    "taskforcesh/bullmq-php": "dev-master"
  },
  "minimum-stability": "dev",
  "prefer-stable": true
}
```

Then run:

```bash
composer install
```

Or add it to an existing project:

```bash
composer config repositories.bullmq vcs https://github.com/taskforcesh/bullmq
composer require taskforcesh/bullmq-php:dev-master
```

> **Note:** Stable releases are tagged with the format `vphp{version}` (e.g., `vphp1.0.0`). Check the [releases page](https://github.com/taskforcesh/bullmq/releases) for available versions.

## Quick Start

### Creating a Queue

```php
use BullMQ\Queue;

// Create a queue with default connection (localhost:6379)
$queue = new Queue('my-queue');

// Or with custom Redis connection
$queue = new Queue('my-queue', [
    'connection' => [
        'host' => 'redis.example.com',
        'port' => 6379,
        'password' => 'your-password',
    ],
]);
```

### Adding Jobs

```php
use BullMQ\Queue;

$queue = new Queue('email-queue');

// Add a simple job
$job = $queue->add('send-email', [
    'to' => 'user@example.com',
    'subject' => 'Welcome!',
    'body' => 'Thanks for signing up.',
]);

echo "Job added with ID: " . $job->id . "\n";
```

### Job Options

```php
// Delayed job (delay in milliseconds)
$job = $queue->add('reminder', $data, [
    'delay' => 60000, // Process after 60 seconds
]);

// Priority job (lower number = higher priority)
$job = $queue->add('urgent', $data, [
    'priority' => 1,
]);

// Custom job ID
$job = $queue->add('process-order', $data, [
    'jobId' => 'order-' . $orderId,
]);

// Job with retry settings
$job = $queue->add('flaky-operation', $data, [
    'attempts' => 3,
    'backoff' => [
        'type' => 'exponential',
        'delay' => 1000,
    ],
]);

// Job with removal policy
$job = $queue->add('task', $data, [
    'removeOnComplete' => true,
    'removeOnFail' => 100, // Keep last 100 failed jobs
]);

// LIFO (Last In, First Out) - process newest jobs first
$job = $queue->add('task', $data, [
    'lifo' => true,
]);

// Custom timestamp (defaults to current time)
$job = $queue->add('task', $data, [
    'timestamp' => (int)(microtime(true) * 1000),
]);
```

### Adding Multiple Jobs

```php
$jobs = $queue->addBulk([
    ['name' => 'email', 'data' => ['to' => 'user1@example.com']],
    ['name' => 'email', 'data' => ['to' => 'user2@example.com']],
    ['name' => 'email', 'data' => ['to' => 'user3@example.com']],
]);
```

### Getting Job Information

```php
// Get a specific job
$job = $queue->getJob('job-id');
if ($job) {
    echo "Job name: " . $job->name . "\n";
    echo "Job data: " . json_encode($job->data) . "\n";
    echo "Job state: " . $queue->getJobState($job->id) . "\n";
}

// Get jobs by state
$waitingJobs = $queue->getWaiting(0, 10);
$activeJobs = $queue->getActive(0, 10);
$delayedJobs = $queue->getDelayed(0, 10);
$completedJobs = $queue->getCompleted(0, 10);
$failedJobs = $queue->getFailed(0, 10);

// Get job counts
$counts = $queue->getJobCounts();
echo "Waiting: " . $counts['waiting'] . "\n";
echo "Active: " . $counts['active'] . "\n";
echo "Delayed: " . $counts['delayed'] . "\n";
echo "Completed: " . $counts['completed'] . "\n";
echo "Failed: " . $counts['failed'] . "\n";

// Get count for specific types
$pending = $queue->getJobCountByTypes('waiting', 'delayed');
echo "Pending jobs: " . $pending . "\n";

// Get counts grouped by priority
$priorityCounts = $queue->getCountsPerPriority([0, 1, 2, 3]);
echo "Priority 0: " . $priorityCounts[0] . "\n";
echo "Priority 1: " . $priorityCounts[1] . "\n";
```

### Queue Management

```php
// Pause the queue
$queue->pause();
echo "Queue paused: " . ($queue->isPaused() ? 'yes' : 'no') . "\n";

// Resume the queue
$queue->resume();

// Remove a specific job
$removed = $queue->remove('job-id');

// Clean old jobs (grace period in milliseconds)
$cleaned = $queue->clean(
    grace: 3600000,  // 1 hour
    limit: 100,
    type: 'completed'
);

// Retry failed jobs with options
$queue->retryJobs([
    'count' => 100,      // Max jobs to retry per iteration
    'state' => 'failed', // State to retry from: 'failed' or 'completed'
    'timestamp' => time() * 1000, // Only retry jobs before this timestamp
]);

// Promote delayed jobs (move to waiting)
$queue->promoteJobs(['count' => 100]);

// Drain the queue (remove all waiting jobs)
$queue->drain();

// Obliterate the queue (remove everything)
$queue->obliterate(['force' => true]);
```

### Parent-Child Jobs (Flows)

```php
// Add a child job with a parent
$childJob = $queue->add('child-task', $childData, [
    'parent' => [
        'id' => 'parent-job-id',
        'queue' => 'bull:parent-queue',
    ],
]);
```

## Job States

Jobs can be in one of the following states:

- `waiting` - Job is waiting to be processed
- `active` - Job is currently being processed
- `delayed` - Job is delayed and waiting for its delay to expire
- `completed` - Job has been successfully processed
- `failed` - Job has failed after all retry attempts
- `paused` - Job is in a paused queue
- `prioritized` - Job is in the prioritized set
- `waiting-children` - Parent job waiting for child jobs to complete

## Connection Options

```php
// Using a connection array
$queue = new Queue('my-queue', [
    'connection' => [
        'host' => 'localhost',
        'port' => 6379,
        'database' => 0,
        'password' => null,
        'username' => null,
    ],
]);

// Using a Redis URI
$queue = new Queue('my-queue', [
    'connection' => 'redis://user:password@localhost:6379/0',
]);

// Sharing a connection
use BullMQ\RedisConnection;

$connection = new RedisConnection([
    'host' => 'localhost',
    'port' => 6379,
]);

$queue1 = new Queue('queue-1', ['connection' => $connection]);
$queue2 = new Queue('queue-2', ['connection' => $connection]);

// Custom prefix
$queue = new Queue('my-queue', [
    'prefix' => 'myapp',
]);
```

## Interoperability

Jobs added with this PHP library can be processed by BullMQ workers in:

- **Node.js** - Using the official [BullMQ](https://www.npmjs.com/package/bullmq) package
- **Python** - Using the [BullMQ Python](https://pypi.org/project/bullmq/) package
- **Elixir** - Using the [BullMQ Elixir](https://hex.pm/packages/bullmq) package

Example Node.js worker:

```javascript
import { Worker } from 'bullmq';

const worker = new Worker('my-queue', async job => {
  console.log(`Processing job ${job.id} with data:`, job.data);
  // Process the job...
  return { success: true };
});
```

## Error Handling

```php
use BullMQ\Queue;

try {
    $queue = new Queue('my-queue');
    $job = $queue->add('task', $data);
} catch (\RuntimeException $e) {
    echo "Error: " . $e->getMessage() . "\n";
}
```

## Testing

```bash
composer test
```

## License

MIT License - see [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

## API Reference

### Queue Methods

| Method                                  | Description                             |
| --------------------------------------- | --------------------------------------- |
| `add(name, data, opts)`                 | Add a single job to the queue           |
| `addBulk(jobs)`                         | Add multiple jobs in a single operation |
| `getJob(id)`                            | Get a job by its ID                     |
| `getJobs(jobIds)`                       | Get multiple jobs by their IDs          |
| `getJobsByType(types, start, end, asc)` | Get jobs by type(s) with pagination     |
| `getJobState(id)`                       | Get the current state of a job          |
| `getJobCounts()`                        | Get job counts for all states           |
| `getJobCountByTypes(...types)`          | Get total count for specific types      |
| `getCountsPerPriority(priorities)`      | Get counts grouped by priority          |
| `getWaiting(start, end)`                | Get waiting jobs                        |
| `getActive(start, end)`                 | Get active jobs                         |
| `getDelayed(start, end)`                | Get delayed jobs                        |
| `getPrioritized(start, end)`            | Get prioritized jobs                    |
| `getCompleted(start, end)`              | Get completed jobs                      |
| `getFailed(start, end)`                 | Get failed jobs                         |
| `pause()`                               | Pause the queue                         |
| `resume()`                              | Resume the queue                        |
| `isPaused()`                            | Check if queue is paused                |
| `remove(jobId)`                         | Remove a specific job                   |
| `clean(grace, limit, type)`             | Clean old jobs                          |
| `drain(delayed)`                        | Remove all waiting/delayed jobs         |
| `obliterate(opts)`                      | Remove all queue data                   |
| `retryJobs(opts)`                       | Retry failed/completed jobs             |
| `promoteJobs(opts)`                     | Promote delayed jobs to waiting         |
| `close()`                               | Close the connection                    |

### Job Options

| Option             | Type           | Description                             |
| ------------------ | -------------- | --------------------------------------- |
| `jobId`            | string         | Custom job ID                           |
| `delay`            | int            | Delay in milliseconds before processing |
| `priority`         | int            | Priority (lower = higher priority)      |
| `attempts`         | int            | Number of retry attempts                |
| `backoff`          | array/int      | Backoff strategy for retries            |
| `lifo`             | bool           | Process newest jobs first               |
| `removeOnComplete` | bool/int/array | Remove job on completion                |
| `removeOnFail`     | bool/int/array | Remove job on failure                   |
| `timestamp`        | int            | Job creation timestamp (ms)             |
| `parent`           | array          | Parent job reference for flows          |

> **Note on Job Schedulers**: Repeatable/scheduled jobs (cron patterns) should be created from the Node.js side using `JobScheduler`. The PHP client is designed for adding individual jobs, not managing schedulers.

## Links

- [BullMQ Documentation](https://docs.bullmq.io)
- [BullMQ Website](https://bullmq.io)
- [GitHub Repository](https://github.com/taskforcesh/bullmq)
