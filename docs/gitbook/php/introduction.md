---
description: BullMQ PHP client for adding jobs to queues.
---

# Introduction

The PHP package provides a **Queue client** that allows you to add jobs to BullMQ queues from your PHP applications. These jobs can then be processed by workers written in Node.js, Python, or Elixir.

{% hint style="info" %}
The PHP package only implements the Queue class (producer side). Workers are not included as PHP's execution model is not well-suited for long-running worker processes. Use Node.js, Python, or Elixir workers to process the jobs.
{% endhint %}

### Installation

This package is distributed directly from the BullMQ monorepo. Add the repository to your `composer.json`:

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

Or add it to an existing project via command line:

```bash
composer config repositories.bullmq vcs https://github.com/taskforcesh/bullmq
composer require taskforcesh/bullmq-php:dev-master
```

### Requirements

- PHP 8.1 or higher
- Redis 5.0 or higher (6.2+ recommended)
- Composer

### Get started

You can add jobs to a queue like this:

```php
<?php

use BullMQ\Queue;

$queue = new Queue('myQueue');

// Add a job with data to the queue
$job = $queue->add('myJob', ['foo' => 'bar']);

echo "Added job with ID: " . $job->id . "\n";

// Close when done
$queue->close();
```

### Job Options

You can pass various options when adding jobs:

```php
<?php

use BullMQ\Queue;

$queue = new Queue('myQueue');

// Delayed job (delay in milliseconds)
$job = $queue->add('sendEmail', $emailData, [
    'delay' => 60000, // Process after 60 seconds
]);

// Priority job (lower number = higher priority)
$job = $queue->add('urgent', $data, [
    'priority' => 1,
]);

// Job with custom ID
$job = $queue->add('processOrder', $orderData, [
    'jobId' => 'order-' . $orderId,
]);

// Job with retry settings
$job = $queue->add('flakyOperation', $data, [
    'attempts' => 3,
    'backoff' => [
        'type' => 'exponential',
        'delay' => 1000,
    ],
]);

// LIFO (Last In, First Out) - process newest jobs first
$job = $queue->add('task', $data, [
    'lifo' => true,
]);
```

### Adding Multiple Jobs

```php
<?php

$jobs = $queue->addBulk([
    ['name' => 'email', 'data' => ['to' => 'user1@example.com']],
    ['name' => 'email', 'data' => ['to' => 'user2@example.com']],
    ['name' => 'email', 'data' => ['to' => 'user3@example.com']],
]);
```

### Queue Management

```php
<?php

// Get job counts
$counts = $queue->getJobCounts();
echo "Waiting: " . $counts['waiting'] . "\n";
echo "Active: " . $counts['active'] . "\n";

// Get a specific job
$job = $queue->getJob('job-id');

// Pause/Resume the queue
$queue->pause();
$queue->resume();

// Clean old jobs
$cleaned = $queue->clean(3600000, 100, 'completed'); // 1 hour grace period
```

### Interoperability

Jobs added with the PHP client are fully compatible with BullMQ workers in:

- **Node.js** - Using the official [BullMQ](https://www.npmjs.com/package/bullmq) package
- **Python** - Using the [BullMQ Python](https://pypi.org/project/bullmq/) package
- **Elixir** - Using the [BullMQ Elixir](https://hex.pm/packages/bullmq) package

Example Node.js worker that processes jobs added from PHP:

```javascript
import { Worker } from 'bullmq';

const worker = new Worker('myQueue', async job => {
  console.log(`Processing job ${job.id} with data:`, job.data);
  // Process the job...
  return { success: true };
});
```

### Connection Options

```php
<?php

use BullMQ\Queue;

// Custom Redis connection
$queue = new Queue('myQueue', [
    'connection' => [
        'host' => 'redis.example.com',
        'port' => 6379,
        'password' => 'your-password',
    ],
]);

// Using a Redis URI
$queue = new Queue('myQueue', [
    'connection' => 'redis://user:password@localhost:6379/0',
]);

// Custom prefix
$queue = new Queue('myQueue', [
    'prefix' => 'myapp',
]);
```

### Retry and Promote Jobs

```php
<?php

// Retry failed jobs with options
$queue->retryJobs([
    'count' => 100,      // Max jobs to retry per iteration
    'state' => 'failed', // State to retry from: 'failed' or 'completed'
]);

// Promote all delayed jobs to waiting
do {
    $cursor = $queue->promoteJobs(100);
} while ($cursor > 0);

// Get counts by priority
$counts = $queue->getCountsPerPriority([0, 1, 2, 3]);
```

{% hint style="warning" %}
**Note on Job Schedulers**: Repeatable/scheduled jobs (cron patterns) should be created from the Node.js side using `JobScheduler`. The PHP client is designed for adding individual jobs, not managing schedulers.
{% endhint %}

### More Information

For more details, see the [PHP README](https://github.com/taskforcesh/bullmq/tree/master/php) on GitHub.
