# Testing

This guide covers best practices for testing your BullMQ queue workflows.

## Setting Up Redis with Docker

The recommended approach is to run Redis in a Docker container. This eliminates the need for mocking and ensures your tests work with actual Redis commands.

### Docker Compose

Create a `docker-compose.yml` file:

```yaml
version: '3.2'
services:
  redis:
    image: redis:7-alpine
    container_name: redis-test
    ports:
      - 6379:6379
```

Start Redis before running your tests:

```bash
docker-compose up -d
```

### Environment Variables

Use environment variables to configure the Redis connection, making it easy to switch between local development and CI environments:

```typescript
const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || 6379;
```

## Test Structure

### Basic Setup with Vitest/Jest

Here's a recommended test setup pattern:

```typescript
import IORedis from 'ioredis';
import { Queue, Worker, QueueEvents, Job } from 'bullmq';
import { v4 as uuid } from 'uuid';

describe('my queue workflow', () => {
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = 'test'; // Use a test prefix to isolate test data

  let queue: Queue;
  let queueEvents: QueueEvents;
  let queueName: string;
  let connection: IORedis;

  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    // Use unique queue names to prevent test interference
    queueName = `test-${uuid()}`;
    queue = new Queue(queueName, { connection, prefix });
    queueEvents = new QueueEvents(queueName, { connection, prefix });
    await queueEvents.waitUntilReady();
  });

  afterEach(async () => {
    await queue.close();
    await queueEvents.close();
    // Clean up test data
    await removeAllQueueData(new IORedis(redisHost), queueName, prefix);
  });

  afterAll(async () => {
    await connection.quit();
  });

  // Your tests here...
});
```

### Cleanup Helper

Create a helper function to clean up queue data between tests:

```typescript
async function removeAllQueueData(
  client: IORedis,
  queueName: string,
  prefix = 'bull',
) {
  const pattern = `${prefix}:${queueName}:*`;
  const keys = await client.keys(pattern);
  if (keys.length) {
    await client.del(...keys);
  }
}
```

## Using Events for Waiting on Transitions

BullMQ emits events when jobs transition between states. **Using events is the recommended way to wait for job state transitions** in your tests, as it avoids polling and race conditions.

### Worker Events

The Worker class emits events for job lifecycle:

```typescript
it('should process a job successfully', async () => {
  const worker = new Worker(
    queueName,
    async (job) => {
      // Process the job
      return { result: job.data.value * 2 };
    },
    { connection, prefix },
  );
  await worker.waitUntilReady();

  // Create a promise that resolves when the job completes
  const completed = new Promise<void>((resolve, reject) => {
    worker.on('completed', (job, returnValue) => {
      try {
        expect(returnValue.result).toBe(84);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });

  await queue.add('test', { value: 42 });

  // Wait for the job to complete
  await completed;

  await worker.close();
});
```

### Testing Job Failures

Use the `failed` event to test error handling:

```typescript
it('should handle job failures', async () => {
  const jobError = new Error('Processing failed');

  const worker = new Worker(
    queueName,
    async () => {
      throw jobError;
    },
    { connection, prefix },
  );
  await worker.waitUntilReady();

  const failing = new Promise<void>((resolve, reject) => {
    worker.once('failed', (job, err) => {
      try {
        expect(err.message).toBe('Processing failed');
        expect(job?.data.foo).toBe('bar');
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });

  await queue.add('test', { foo: 'bar' });

  await failing;
  await worker.close();
});
```

### QueueEvents for Global Monitoring

`QueueEvents` provides events across all workers, useful for integration tests:

```typescript
it('should track job progress', async () => {
  const processing = new Promise<void>((resolve, reject) => {
    queueEvents.on('progress', ({ jobId, data }) => {
      try {
        expect(data).toBe(50);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });

  const worker = new Worker(
    queueName,
    async (job) => {
      await job.updateProgress(50);
      return 'done';
    },
    { connection, prefix },
  );
  await worker.waitUntilReady();

  await queue.add('test', { foo: 'bar' });

  await processing;
  await worker.close();
});
```

### Waiting for Multiple Jobs

Use helpers like `lodash.after` to wait for multiple jobs:

```typescript
import { after } from 'lodash';

it('should process multiple jobs', async () => {
  const jobCount = 5;

  const worker = new Worker(queueName, async () => 'done', {
    connection,
    prefix,
  });
  await worker.waitUntilReady();

  const allCompleted = new Promise<void>((resolve) => {
    const resolveAfterAll = after(jobCount, resolve);
    worker.on('completed', resolveAfterAll);
  });

  // Add multiple jobs
  for (let i = 0; i < jobCount; i++) {
    await queue.add('test', { index: i });
  }

  await allCompleted;
  await worker.close();
});
```

## Testing Job Retries

Test retry behavior by tracking attempt counts:

```typescript
it('should retry failed jobs', async () => {
  let attempts = 0;

  const worker = new Worker(
    queueName,
    async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Temporary failure');
      }
      return 'success';
    },
    { connection, prefix },
  );
  await worker.waitUntilReady();

  const completed = new Promise<void>((resolve, reject) => {
    worker.on('completed', (job) => {
      try {
        expect(job?.attemptsMade).toBe(3);
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });

  await queue.add('test', {}, { attempts: 3 });

  await completed;
  expect(attempts).toBe(3);
  await worker.close();
});
```

## Testing with autorun: false

For more control over when processing starts, use `autorun: false`:

```typescript
it('should process jobs when manually started', async () => {
  const worker = new Worker(
    queueName,
    async (job) => {
      return job.data.value;
    },
    { autorun: false, connection, prefix },
  );
  await worker.waitUntilReady();

  // Add job before worker starts processing
  const job = await queue.add('test', { value: 42 });

  const completed = new Promise<void>((resolve) => {
    worker.on('completed', resolve);
  });

  // Manually start the worker
  worker.run();

  await completed;
  await worker.close();
});
```

## Testing Return Values

Verify job return values are stored correctly:

```typescript
it('should store return value', async () => {
  const worker = new Worker(
    queueName,
    async () => {
      return { computed: 'result' };
    },
    { connection, prefix },
  );
  await worker.waitUntilReady();

  const completed = new Promise<Job>((resolve) => {
    worker.on('completed', (job) => resolve(job!));
  });

  const job = await queue.add('test', {});
  const completedJob = await completed;

  // Fetch fresh job data from Redis
  const storedJob = await queue.getJob(job.id!);
  expect(storedJob?.returnvalue).toEqual({ computed: 'result' });

  await worker.close();
});
```

## Common Event Reference

### Worker Events

| Event | Description | Callback Arguments |
|-------|-------------|-------------------|
| `completed` | Job completed successfully | `(job, returnValue)` |
| `failed` | Job failed | `(job, error)` |
| `progress` | Job progress updated | `(job, progress)` |
| `active` | Job started processing | `(job, prev)` |
| `stalled` | Job stalled (lock expired) | `(jobId)` |
| `error` | Worker error | `(error)` |

### QueueEvents Events

| Event | Description | Callback Arguments |
|-------|-------------|-------------------|
| `completed` | Job completed | `{ jobId, returnvalue }` |
| `failed` | Job failed | `{ jobId, failedReason }` |
| `progress` | Job progress updated | `{ jobId, data }` |
| `waiting` | Job waiting to be processed | `{ jobId }` |
| `active` | Job started processing | `{ jobId }` |
| `delayed` | Job delayed | `{ jobId, delay }` |

## Tips

{% hint style="info" %}
Always call `await worker.waitUntilReady()` before adding jobs to ensure the worker is connected and ready to process.
{% endhint %}

{% hint style="warning" %}
Remember to close all Queue, Worker, and QueueEvents instances in your `afterEach` or `afterAll` hooks to prevent connection leaks.
{% endhint %}

{% hint style="info" %}
Use unique queue names (e.g., with UUID) for each test to prevent test interference when running tests in parallel.
{% endhint %}
