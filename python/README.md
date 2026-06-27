# BullMQ For Python

This is the official BullMQ Python library. It is a close port of the NodeJS version of the library.
Python Queues are interoperable with NodeJS Queues, as both libraries use the same .lua scripts that
power all the functionality.

## Features

Currently, the library does not support all the features available in the NodeJS version. The following
have been ported so far:

- [ ] Add jobs to queues.

  - [x] Regular jobs.
  - [x] Delayed jobs.
  - [x] Job deduplication.
  - [ ] Job priority.
  - [ ] Repeatable.

- [x] Workers
- [ ] Job events.
- [x] Job progress.
- [ ] Job retries.
- [x] Job backoff.
- [x] Getters.

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
