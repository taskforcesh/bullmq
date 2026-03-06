---
description: Process multiple jobs efficiently using batching techniques
---

# Working with Batches

BullMQ provides several ways to work with batches of jobs, allowing you to process multiple jobs more efficiently. This guide covers different batching strategies depending on your use case.

## Overview

There are two main approaches to batch processing in BullMQ:

1. **Adding jobs in bulk**: Adding multiple jobs to the queue efficiently
2. **Processing jobs in batches**: Consuming multiple jobs together for better performance

## Adding Jobs in Bulk

When you need to add many jobs at once, use the `addBulk` method for better performance:

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('my-queue');

// Add multiple jobs in a single operation
const jobs = await queue.addBulk([
  { name: 'job-1', data: { userId: 1, action: 'email' } },
  { name: 'job-2', data: { userId: 2, action: 'email' } },
  { name: 'job-3', data: { userId: 3, action: 'sms' } },
]);

console.log(`Added ${jobs.length} jobs`);
```

### Benefits of addBulk

- **Reduced Redis round trips**: All jobs are added in a single Redis pipeline
- **Better performance**: Significantly faster than adding jobs one by one
- **Atomic operation**: All jobs are added together (or none if it fails)

### Adding Jobs with Options

You can also specify job options for each job:

```typescript
const jobs = await queue.addBulk([
  { 
    name: 'priority-job', 
    data: { userId: 1 },
    opts: { priority: 10 }
  },
  { 
    name: 'delayed-job', 
    data: { userId: 2 },
    opts: { delay: 5000 }
  },
  { 
    name: 'repeatable-job', 
    data: { userId: 3 },
    opts: { repeat: { cron: '0 9 * * *' } }
  },
]);
```

## Processing Jobs in Batches

While BullMQ typically processes jobs one at a time per worker, you can implement batch processing in your worker logic:

### Manual Batch Processing

```typescript
import { Worker, Job } from 'bullmq';

const BATCH_SIZE = 10;

const worker = new Worker('my-queue', async (job: Job) => {
  // This worker processes one job at a time
  // But we can batch operations within it
  
  const data = job.data;
  
  // Example: Batch database inserts
  await processSingleJob(data);
}, {
  connection,
  concurrency: 5, // Process up to 5 jobs concurrently
});
```

### Custom Batch Processing Pattern

For true batch processing where you want to accumulate jobs and process them together:

```typescript
import { Worker, Job } from 'bullmq';

class BatchProcessor {
  private batch: Job[] = [];
  private timeout: NodeJS.Timeout | null = null;
  private readonly batchSize: number;
  private readonly timeoutMs: number;

  constructor(batchSize = 10, timeoutMs = 1000) {
    this.batchSize = batchSize;
    this.timeoutMs = timeoutMs;
  }

  async addJob(job: Job): Promise<void> {
    this.batch.push(job);
    
    if (this.batch.length >= this.batchSize) {
      await this.flush();
    } else if (!this.timeout) {
      this.timeout = setTimeout(() => this.flush(), this.timeoutMs);
    }
  }

  private async flush(): Promise<void> {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    
    if (this.batch.length === 0) return;
    
    const currentBatch = [...this.batch];
    this.batch = [];
    
    // Process the entire batch
    try {
      await this.processBatch(currentBatch);
      
      // Mark all jobs as completed
      for (const job of currentBatch) {
        await job.moveToCompleted('Batch processed successfully', 'token');
      }
    } catch (error) {
      // Handle batch failure
      for (const job of currentBatch) {
        await job.moveToFailed(error, 'token');
      }
    }
  }

  private async processBatch(jobs: Job[]): Promise<void> {
    // Your batch processing logic here
    console.log(`Processing batch of ${jobs.length} jobs`);
    
    // Example: Batch API call
    const results = await batchApiCall(jobs.map(j => j.data));
    
    // Process results
    for (let i = 0; i < jobs.length; i++) {
      jobs[i].returnvalue = results[i];
    }
  }
}

// Usage
const processor = new BatchProcessor(10, 5000);

const worker = new Worker('my-queue', async (job) => {
  await processor.addJob(job);
}, { connection });
```

## Flows with Batches

When working with flows, you can add multiple jobs at different levels:

```typescript
import { FlowProducer } from 'bullmq';

const flowProducer = new FlowProducer();

// Create a flow with multiple children
const flow = await flowProducer.add({
  name: 'parent-job',
  queueName: 'parent-queue',
  data: { action: 'process-orders' },
  children: [
    { 
      name: 'child-1', 
      queueName: 'child-queue', 
      data: { orderId: 1 } 
    },
    { 
      name: 'child-2', 
      queueName: 'child-queue', 
      data: { orderId: 2 } 
    },
    { 
      name: 'child-3', 
      queueName: 'child-queue', 
      data: { orderId: 3 } 
    },
  ],
});
```

## Best Practices

### 1. Choose the Right Batch Size

```typescript
// Too small: Overhead not worth it
const smallBatch = await queue.addBulk(jobs.slice(0, 3));

// Good balance for most cases
const goodBatch = await queue.addBulk(jobs.slice(0, 100));

// Too large: May cause memory issues
const largeBatch = await queue.addBulk(jobs.slice(0, 10000));
```

Recommended batch sizes:
- **Small jobs** (light data): 100-500 jobs
- **Medium jobs**: 50-100 jobs
- **Large jobs** (heavy data): 10-50 jobs

### 2. Error Handling in Batches

```typescript
try {
  const jobs = await queue.addBulk(jobDataList);
  console.log(`Successfully added ${jobs.length} jobs`);
} catch (error) {
  console.error('Failed to add jobs:', error);
  // Implement retry logic if needed
}
```

### 3. Rate Limiting with Batches

When adding jobs in bulk, be mindful of rate limits:

```typescript
import { Queue } from 'bullmq';

const queue = new Queue('api-calls', {
  limiter: {
    max: 100,
    duration: 1000, // 100 jobs per second
  },
});

// Add jobs in chunks to respect rate limits
const chunkSize = 100;
for (let i = 0; i < allJobs.length; i += chunkSize) {
  const chunk = allJobs.slice(i, i + chunkSize);
  await queue.addBulk(chunk);
  
  // Optional: Add delay between chunks
  if (i + chunkSize < allJobs.length) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
```

### 4. Job Deduplication with Batches

Prevent duplicate jobs when adding in bulk:

```typescript
// Use job IDs for deduplication
const jobsWithIds = data.map(item => ({
  name: 'process-item',
  data: item,
  opts: {
    jobId: `item-${item.id}`, // Unique ID
  },
}));

await queue.addBulk(jobsWithIds);
```

## Performance Considerations

### Memory Usage

When processing large batches, monitor memory usage:

```typescript
const processLargeBatch = async (items: any[]) => {
  const BATCH_SIZE = 1000;
  
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    
    // Process batch
    await queue.addBulk(batch.map(item => ({
      name: 'process',
      data: item,
    })));
    
    // Allow GC to run
    if (global.gc) {
      global.gc();
    }
  }
};
```

### Redis Memory

Large batches can consume significant Redis memory. Monitor your Redis instance and adjust batch sizes accordingly.

## Advanced Patterns

### Conditional Batching

Process jobs differently based on queue depth:

```typescript
const worker = new Worker('my-queue', async (job) => {
  const waitingCount = await queue.getWaitingCount();
  
  if (waitingCount > 100) {
    // High load: Use batch processing
    await fastBatchProcess(job);
  } else {
    // Normal load: Standard processing
    await normalProcess(job);
  }
}, { connection });
```

### Batch Job Dependencies

Create dependencies within a batch:

```typescript
import { FlowProducer } from 'bullmq';

const flowProducer = new FlowProducer();

// Jobs within a batch that depend on each other
const batchFlow = await flowProducer.add({
  name: 'aggregate-results',
  queueName: 'aggregation-queue',
  children: [
    {
      name: 'fetch-data-1',
      queueName: 'fetch-queue',
      opts: { jobId: 'fetch-1' },
    },
    {
      name: 'fetch-data-2',
      queueName: 'fetch-queue',
      opts: { jobId: 'fetch-2' },
    },
    {
      name: 'process-data',
      queueName: 'process-queue',
      opts: { jobId: 'process-1' },
      children: [
        { name: 'transform-1', queueName: 'transform-queue' },
        { name: 'transform-2', queueName: 'transform-queue' },
      ],
    },
  ],
});
```

## Summary

- Use `addBulk()` for efficiently adding multiple jobs
- Implement custom batch processing for consuming jobs in groups
- Choose appropriate batch sizes based on job complexity
- Always handle errors gracefully
- Monitor memory and Redis usage with large batches

For true atomic batch processing where all jobs must succeed or fail together, consider using [BullMQ Pro](https://docs.bullmq.io/bullmq-pro/batches) which provides built-in batch support with advanced features.
