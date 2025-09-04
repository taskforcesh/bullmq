# Dedicated Lock Thread

BullMQ's dedicated lock thread feature solves a critical issue where long-running or CPU-intensive jobs can block the Node.js event loop, preventing essential lock renewal and stalled job detection operations from executing properly.

## The Problem

In standard BullMQ operation, lock renewal and stalled job detection run in the same event loop as job processing. When jobs perform CPU-intensive operations or block the event loop for extended periods, these critical maintenance operations can be delayed or prevented entirely, leading to:

- Jobs being marked as stalled and moved back to the waiting queue
- Jobs losing their locks and failing when trying to complete
- Inconsistent job processing behavior
- Difficulty processing long-running tasks reliably

## The Solution

The dedicated lock thread feature moves lock renewal and stalled job detection into a separate worker thread, ensuring these operations continue running independently of the main job processing thread.

## Basic Usage

Enable the dedicated lock thread by setting the `useDedicatedLockThread` option to `true`:

```typescript
import { Worker } from 'bullmq';

const worker = new Worker(
  'myqueue',
  async job => {
    // Long-running or CPU-intensive work
    await performHeavyComputation(job.data);
    return { success: true };
  },
  {
    connection: redisConnection,
    useDedicatedLockThread: true, // Enable dedicated lock thread
  },
);
```

## Configuration Options

The dedicated lock thread respects all standard worker lock and stalled job options:

```typescript
const worker = new Worker('myqueue', processor, {
  connection: redisConnection,
  useDedicatedLockThread: true,

  // Lock configuration (affects dedicated thread)
  lockDuration: 30000, // Lock duration in ms (default: 30000)
  lockRenewTime: 15000, // Lock renewal interval in ms (default: lockDuration / 2)
  skipLockRenewal: false, // Skip lock renewal entirely (default: false)

  // Stalled job configuration (affects dedicated thread)
  stalledInterval: 30000, // Stalled check interval in ms (default: 30000)
  maxStalledCount: 1, // Max times a job can be stalled (default: 1)
  skipStalledCheck: false, // Skip stalled job detection (default: false)
});
```

## How It Works

### Traditional Approach

```
Main Thread:
┌─────────────────────────────────────────────────┐
│ Job Processing + Lock Renewal + Stalled Check  │ ← Can be blocked
└─────────────────────────────────────────────────┘
```

### Dedicated Lock Thread Approach

```
Main Thread:                    Dedicated Thread:
┌─────────────────────────┐    ┌─────────────────────────┐
│    Job Processing       │    │ Lock Renewal           │
│                         │    │ +                      │
│                         │    │ Stalled Job Detection  │
└─────────────────────────┘    └─────────────────────────┘
```

### Internal Operation

1. **Initialization**: When a worker starts with `useDedicatedLockThread: true`, it spawns a separate worker thread
2. **Job Tracking**: Active jobs are automatically registered with the dedicated thread for lock management
3. **Lock Renewal**: The dedicated thread independently renews locks at the configured intervals
4. **Stalled Detection**: The dedicated thread monitors and moves stalled jobs back to the waiting queue
5. **Event Communication**: Lock renewal failures and stalled job detection results are communicated back to the main thread
6. **Cleanup**: When jobs complete or fail, they are automatically removed from dedicated thread tracking

## Event Handling

The dedicated lock thread emits the same events as traditional lock management:

```typescript
worker.on('stalled', (jobId, prev) => {
  console.log(`Job ${jobId} was stalled and moved from ${prev}`);
});

worker.on('error', error => {
  if (error.message.includes('could not renew lock')) {
    console.log('Lock renewal failed for a job');
  }
});
```

## Performance Characteristics

### CPU-Intensive Jobs

**Without Dedicated Thread:**

```typescript
// This can block lock renewal
const worker = new Worker(
  'queue',
  async job => {
    // Blocks event loop for 5 seconds
    let result = 0;
    for (let i = 0; i < 10000000000; i++) {
      result += Math.random();
    }
    return result;
  },
  {
    lockDuration: 2000, // Job will lose lock!
  },
);
```

**With Dedicated Thread:**

```typescript
// Lock renewal continues independently
const worker = new Worker(
  'queue',
  async job => {
    // Blocks event loop for 5 seconds
    let result = 0;
    for (let i = 0; i < 10000000000; i++) {
      result += Math.random();
    }
    return result;
  },
  {
    lockDuration: 2000,
    useDedicatedLockThread: true, // Locks remain active!
  },
);
```

### Long-Running Jobs

```typescript
const worker = new Worker(
  'queue',
  async job => {
    // Long-running job that exceeds lock duration
    await processLargeDataset(job.data); // Takes 2 minutes
    return { processed: true };
  },
  {
    lockDuration: 30000, // 30 second locks
    lockRenewTime: 15000, // Renew every 15 seconds
    useDedicatedLockThread: true, // Ensures continuous renewal
  },
);
```

## Concurrency Support

The dedicated lock thread works seamlessly with concurrent job processing:

```typescript
const worker = new Worker('queue', processor, {
  concurrency: 10, // Process 10 jobs simultaneously
  useDedicatedLockThread: true, // All jobs managed by dedicated thread
  lockDuration: 60000,
});
```

The dedicated thread efficiently manages locks for all concurrent jobs, regardless of their individual processing characteristics.

## Error Handling and Resilience

### Dedicated Thread Errors

If the dedicated thread encounters errors, they are propagated to the main worker:

```typescript
worker.on('error', error => {
  if (error.message.includes('Failed to initialize dedicated lock thread')) {
    // Handle initialization failure
    console.error('Dedicated lock thread failed to start:', error);
  }
});
```

### Fallback Behavior

If the dedicated thread fails to start or encounters fatal errors, the worker will emit an error but can continue operating. However, lock renewal and stalled job detection will not function properly.

### Redis Connection Issues

The dedicated thread maintains its own Redis connection. If this connection fails:

- Lock renewal attempts will fail and be reported as errors
- Stalled job detection will be interrupted
- The main worker will receive error events for failed lock renewals

## Monitoring and Debugging

### Lock Renewal Monitoring

```typescript
// Access internal lock manager thread for monitoring
const lockManager = worker['lockManagerThread'];

if (lockManager) {
  lockManager.on('lockExtended', jobIds => {
    console.log(`Successfully renewed locks for jobs: ${jobIds.join(', ')}`);
  });

  lockManager.on('lockRenewalFailed', jobIds => {
    console.log(`Failed to renew locks for jobs: ${jobIds.join(', ')}`);
  });

  lockManager.on('stalledJobs', stalledJobIds => {
    console.log(`Detected stalled jobs: ${stalledJobIds.join(', ')}`);
  });
}
```

### Status Checking

```typescript
// Check if dedicated thread is running
if (worker['lockManagerThread']?.isRunning()) {
  console.log('Dedicated lock thread is active');

  // Get currently monitored jobs
  const monitoredJobs = worker['lockManagerThread'].getMonitoredJobs();
  console.log(`Monitoring ${monitoredJobs.length} jobs`);
}
```

## Best Practices

### When to Use

✅ **Use dedicated lock thread when:**

- Processing CPU-intensive jobs
- Jobs run longer than lock duration
- Using external APIs with unpredictable response times
- Performing file I/O or network operations that might block
- Processing large datasets
- Running ML/AI computations

❌ **Not necessary when:**

- Jobs complete quickly (well under lock duration)
- Simple data transformations
- Jobs that don't block the event loop

### Configuration Recommendations

```typescript
// For CPU-intensive jobs
const cpuIntensiveWorker = new Worker('cpu-queue', processor, {
  useDedicatedLockThread: true,
  lockDuration: 60000, // Longer locks for safety
  lockRenewTime: 20000, // More frequent renewal
  stalledInterval: 30000, // Regular stalled checks
  concurrency: 1, // Limit concurrency for CPU-bound work
});

// For I/O intensive jobs
const ioIntensiveWorker = new Worker('io-queue', processor, {
  useDedicatedLockThread: true,
  lockDuration: 30000,
  lockRenewTime: 10000, // Frequent renewal for reliability
  stalledInterval: 15000, // Quick stalled detection
  concurrency: 5, // Higher concurrency for I/O
});
```

### Resource Management

```typescript
// Ensure proper cleanup
process.on('SIGTERM', async () => {
  await worker.close(); // This will also stop the dedicated thread
});
```

## Requirements

- Node.js with worker_threads support (Node.js 12+)
- Redis connection that can be serialized for worker thread communication
- BullMQ version 6.0+ (when this feature is released)

## Migration Guide

Existing workers can be migrated by simply adding the `useDedicatedLockThread` option:

```typescript
// Before
const worker = new Worker('queue', processor, {
  connection: redisConnection,
  lockDuration: 30000,
});

// After
const worker = new Worker('queue', processor, {
  connection: redisConnection,
  lockDuration: 30000,
  useDedicatedLockThread: true, // Add this line
});
```

No other code changes are required. The worker will behave identically except for improved lock management reliability.

## Troubleshooting

### Common Issues

**Issue: "could not be cloned" errors**

```
Solution: Ensure Redis connection options don't contain functions or non-serializable objects
```

**Issue: Dedicated thread fails to start**

```
Solution: Check Redis connectivity and ensure worker_threads are supported
```

**Issue: Higher memory usage**

```
Solution: This is expected due to the additional worker thread and Redis connection
```

### Performance Impact

- **Memory**: Additional ~10-20MB per worker for the dedicated thread
- **CPU**: Minimal overhead for lock management operations
- **Network**: One additional Redis connection per worker
- **Reliability**: Significantly improved for blocking jobs

The performance trade-offs are typically minimal compared to the reliability benefits for applications with long-running or CPU-intensive jobs.
