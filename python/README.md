# BullMQ For Python

This is the official BullMQ Python library. It is a close port of the NodeJS version of the library.
Python Queues are interoperable with NodeJS Queues, as both libraries use the same .lua scripts that
power all the functionality.

## Features

Currently, the library does not support all the features available in the NodeJS version. The following
have been ported so far:

- [x] Add jobs to queues.
  - [x] Regular jobs.
  - [x] Delayed jobs.
  - [x] Job deduplication.
  - [x] Job priority.
  - [x] Repeatable (via [`JobScheduler`](../docs/gitbook/python/job-scheduler.md)).

- [x] Workers
- [x] Job events (via [`QueueEvents`](../docs/gitbook/python/queue-events.md) and `QueueEventsProducer`).
- [x] Job progress.
- [x] Job retries.
- [x] Job backoff.
- [x] Getters.
- [x] [Flow Producer](../docs/gitbook/python/flow-producer.md).
- [x] [Lock Manager](../docs/gitbook/python/lock-manager.md) (batched lock renewal).
- [x] [Global concurrency and rate limit](../docs/gitbook/python/global-concurrency-and-rate-limit.md).
- [x] [Per-job cancellation](../docs/gitbook/python/job-cancellation.md) (cooperative `AbortController`).

## Installation

```bash
pip install bullmq
```

## Usage

### Basic Example

```python
from bullmq import Queue

queue = Queue('my-queue')

job = await queue.add('my-job', {'foo': 'bar'})
```

### Job Priority

Prioritize jobs so higher priority jobs are processed first. Lower number = higher
priority. `1` is the highest priority and `2_097_152` is the lowest. A priority of
`0` (the default) means "no priority" and jobs are processed in FIFO order.

```python
from bullmq import Queue

queue = Queue('my-queue')

# Higher priority job (will be processed first)
await queue.add('paint', {'color': 'red'}, {'priority': 1})

# Lower priority job
await queue.add('paint', {'color': 'blue'}, {'priority': 10})
```

### Job Deduplication

Prevent duplicate jobs from being added to the queue:

```python
from bullmq import Queue

queue = Queue('my-queue')

# Simple mode - deduplicates until job completes or fails
job = await queue.add('paint', {'color': 'white'}, {
    'deduplication': {
        'id': 'custom-dedup-id'
    }
})

# Throttle mode - deduplicates for a specific time window (in milliseconds)
job = await queue.add('paint', {'color': 'white'}, {
    'deduplication': {
        'id': 'custom-dedup-id',
        'ttl': 5000  # 5 seconds
    }
})

# Debounce mode - replaces pending job with latest data
job = await queue.add('paint', {'color': 'white'}, {
    'deduplication': {
        'id': 'custom-dedup-id',
        'ttl': 5000,
        'extend': True,  # Extend TTL on each duplicate attempt
        'replace': True  # Replace job data with latest
    },
    'delay': 5000  # Must be delayed for replace to work
})
```

## Documentation

The documentation is available at [https://docs.bullmq.io](https://docs.bullmq.io/python)

## License

MIT

## Copyright

Copyright (c) 2018-2023, Taskforce.sh Inc. and other contributors.
