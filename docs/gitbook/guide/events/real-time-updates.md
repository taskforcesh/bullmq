---
description: Implement real-time updates and live monitoring for your queues
---

# Real-time Updates

Real-time updates are essential for monitoring job progress, displaying live dashboards, and building reactive applications. BullMQ provides several mechanisms to receive real-time updates about your queues and jobs.

## Overview

BullMQ offers multiple approaches for real-time updates:

1. **Queue Events**: Listen to job lifecycle events
2. **Queue Listeners**: Subscribe to queue-level changes
3. **Job Progress**: Track and report job progress
4. **Custom Events**: Emit and listen to custom events
5. **WebSockets**: Integrate with WebSocket servers for live updates

## Queue Events

The `QueueEvents` class provides a powerful pub/sub mechanism for listening to job events:

```typescript
import { QueueEvents } from 'bullmq';

const queueEvents = new QueueEvents('my-queue');

// Listen to completed jobs
queueEvents.on('completed', ({ jobId, returnvalue }) => {
  console.log(`Job ${jobId} completed with result:`, returnvalue);
});

// Listen to failed jobs
queueEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`Job ${jobId} failed:`, failedReason);
});

// Listen to progress updates
queueEvents.on('progress', ({ jobId, data }) => {
  console.log(`Job ${jobId} progress:`, data);
});
```

### Available Events

```typescript
// Job lifecycle events
queueEvents.on('waiting', ({ jobId }) => {
  console.log(`Job ${jobId} is waiting`);
});

queueEvents.on('active', ({ jobId, prev }) => {
  console.log(`Job ${jobId} is now active (was ${prev})`);
});

queueEvents.on('completed', ({ jobId, returnvalue }) => {
  console.log(`Job ${jobId} completed`);
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`Job ${jobId} failed:`, failedReason);
});

queueEvents.on('stalled', ({ jobId }) => {
  console.warn(`Job ${jobId} stalled`);
});

queueEvents.on('removed', ({ jobId }) => {
  console.log(`Job ${jobId} removed`);
});

// Delayed job events
queueEvents.on('delayed', ({ jobId, delay }) => {
  console.log(`Job ${jobId} delayed by ${delay}ms`);
});

// Drain event (queue empty)
queueEvents.on('drained', () => {
  console.log('Queue drained - all jobs processed');
});

// Pause/Resume events
queueEvents.on('paused', () => {
  console.log('Queue paused');
});

queueEvents.on('resumed', () => {
  console.log('Queue resumed');
});
```

### Event Filtering

Listen to specific events only:

```typescript
// Only listen to completed and failed events
queueEvents.on('completed', handler);
queueEvents.on('failed', handler);

// Or use a more targeted approach
const relevantEvents = ['completed', 'failed', 'stalled'];
relevantEvents.forEach(event => {
  queueEvents.on(event, (data) => {
    console.log(`[${event.toUpperCase()}]`, data);
  });
});
```

## Worker Events

Workers also emit events for more granular control:

```typescript
import { Worker } from 'bullmq';

const worker = new Worker('my-queue', async (job) => {
  // Process job
}, { connection });

// Worker-level events
worker.on('completed', (job) => {
  console.log(`Worker completed job ${job.id}`);
});

worker.on('failed', (job, err) => {
  console.error(`Worker failed job ${job?.id}:`, err);
});

worker.on('progress', (job, progress) => {
  console.log(`Job ${job.id} progress: ${progress}%`);
});

worker.on('drained', () => {
  console.log('Worker drained - no more jobs');
});

// Error handling
worker.on('error', (err) => {
  console.error('Worker error:', err);
});
```

## Job Progress Updates

Report and track job progress in real-time:

### Updating Progress from Worker

```typescript
const worker = new Worker('file-processing', async (job) => {
  const totalFiles = job.data.files.length;
  
  for (let i = 0; i < totalFiles; i++) {
    await processFile(job.data.files[i]);
    
    // Update progress
    const progress = Math.round(((i + 1) / totalFiles) * 100);
    await job.updateProgress(progress);
  }
  
  return { processed: totalFiles };
}, { connection });
```

### Progress with Data

```typescript
// Update progress with additional data
await job.updateProgress({
  percentage: 50,
  stage: 'uploading',
  currentFile: 'document.pdf',
  bytesUploaded: 512000,
  totalBytes: 1024000,
});

// Listen to detailed progress
queueEvents.on('progress', ({ jobId, data }) => {
  console.log(`Job ${jobId}: ${data.percentage}% - ${data.stage}`);
  console.log(`Uploading: ${data.currentFile}`);
  console.log(`Progress: ${data.bytesUploaded}/${data.totalBytes} bytes`);
});
```

## Building a Live Dashboard

Example of building a real-time dashboard with Express and WebSockets:

```typescript
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Queue, QueueEvents } from 'bullmq';

const app = express();
const server = createServer(app);
const io = new Server(server);

const queue = new Queue('my-queue');
const queueEvents = new QueueEvents('my-queue');

// Store current stats
let queueStats = {
  waiting: 0,
  active: 0,
  completed: 0,
  failed: 0,
  delayed: 0,
};

// Update stats periodically
async function updateStats() {
  const [
    waiting,
    active,
    completed,
    failed,
    delayed,
  ] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  
  queueStats = { waiting, active, completed, failed, delayed };
  
  // Broadcast to all connected clients
  io.emit('stats', queueStats);
}

// Initial stats
updateStats();
setInterval(updateStats, 5000); // Update every 5 seconds

// Real-time events
queueEvents.on('completed', ({ jobId }) => {
  io.emit('jobCompleted', { jobId, timestamp: new Date() });
  updateStats();
});

queueEvents.on('failed', ({ jobId, failedReason }) => {
  io.emit('jobFailed', { jobId, reason: failedReason });
  updateStats();
});

queueEvents.on('progress', ({ jobId, data }) => {
  io.emit('jobProgress', { jobId, progress: data });
});

// WebSocket connection
io.on('connection', (socket) => {
  console.log('Client connected');
  
  // Send current stats
  socket.emit('stats', queueStats);
  
  // Handle client requests
  socket.on('getJobs', async (status) => {
    let jobs;
    switch (status) {
      case 'waiting':
        jobs = await queue.getWaiting();
        break;
      case 'active':
        jobs = await queue.getActive();
        break;
      case 'completed':
        jobs = await queue.getCompleted();
        break;
      case 'failed':
        jobs = await queue.getFailed();
        break;
      default:
        jobs = [];
    }
    socket.emit('jobs', { status, jobs });
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

server.listen(3000, () => {
  console.log('Dashboard server running on http://localhost:3000');
});
```

## Custom Events

Emit and listen to custom events for application-specific updates:

### Creating Custom Events

```typescript
import { Job } from 'bullmq';

// In your worker
const worker = new Worker('email-queue', async (job) => {
  await job.updateProgress(10);
  
  // Fetch user data
  const user = await getUser(job.data.userId);
  await job.updateProgress(30);
  
  // Generate email content
  const content = await generateEmail(user, job.data.template);
  await job.updateProgress(60);
  
  // Send email
  const result = await sendEmail(user.email, content);
  
  // Log custom event
  await job.log(`Email sent to ${user.email}`);
  
  // Return with metadata
  return {
    messageId: result.messageId,
    sentAt: new Date().toISOString(),
    recipient: user.email,
  };
});
```

### Listening to Job Logs

```typescript
// Get job logs
const job = await queue.getJob(jobId);
const logs = await job.getLogs();
console.log('Job logs:', logs);

// Or listen in real-time
queueEvents.on('added', async ({ jobId }) => {
  const job = await queue.getJob(jobId);
  job.on('progress', (progress) => {
    console.log(`Job ${jobId} progress:`, progress);
  });
});
```

## Server-Sent Events (SSE)

For simple real-time updates without WebSockets:

```typescript
import express from 'express';
import { QueueEvents } from 'bullmq';

const app = express();
const queueEvents = new QueueEvents('my-queue');

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const sendEvent = (event: string, data: any) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  
  // Subscribe to events
  const onCompleted = ({ jobId }) => {
    sendEvent('completed', { jobId, timestamp: Date.now() });
  };
  
  const onFailed = ({ jobId, failedReason }) => {
    sendEvent('failed', { jobId, reason: failedReason });
  };
  
  const onProgress = ({ jobId, data }) => {
    sendEvent('progress', { jobId, progress: data });
  };
  
  queueEvents.on('completed', onCompleted);
  queueEvents.on('failed', onFailed);
  queueEvents.on('progress', onProgress);
  
  // Clean up on disconnect
  req.on('close', () => {
    queueEvents.off('completed', onCompleted);
    queueEvents.off('failed', onFailed);
    queueEvents.off('progress', onProgress);
  });
});

app.listen(3000);
```

Client-side JavaScript:

```javascript
const eventSource = new EventSource('/events');

eventSource.addEventListener('completed', (event) => {
  const data = JSON.parse(event.data);
  console.log('Job completed:', data);
});

eventSource.addEventListener('failed', (event) => {
  const data = JSON.parse(event.data);
  console.error('Job failed:', data);
});

eventSource.addEventListener('progress', (event) => {
  const data = JSON.parse(event.data);
  updateProgressBar(data.jobId, data.progress);
});
```

## Real-time Job Monitoring

Build a comprehensive monitoring solution:

```typescript
import { Queue, QueueEvents, Job } from 'bullmq';

class QueueMonitor {
  private queue: Queue;
  private queueEvents: QueueEvents;
  private callbacks: Map<string, Function[]> = new Map();
  
  constructor(queueName: string) {
    this.queue = new Queue(queueName);
    this.queueEvents = new QueueEvents(queueName);
    this.setupListeners();
  }
  
  private setupListeners() {
    this.queueEvents.on('completed', (data) => {
      this.notify('completed', data);
    });
    
    this.queueEvents.on('failed', (data) => {
      this.notify('failed', data);
    });
    
    this.queueEvents.on('progress', (data) => {
      this.notify('progress', data);
    });
    
    this.queueEvents.on('stalled', (data) => {
      this.notify('stalled', data);
    });
  }
  
  on(event: string, callback: Function) {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, []);
    }
    this.callbacks.get(event)!.push(callback);
  }
  
  private notify(event: string, data: any) {
    const callbacks = this.callbacks.get(event) || [];
    callbacks.forEach(cb => cb(data));
  }
  
  async getJobDetails(jobId: string) {
    const job = await this.queue.getJob(jobId);
    if (!job) return null;
    
    const state = await job.getState();
    const logs = await job.getLogs();
    
    return {
      id: job.id,
      name: job.name,
      data: job.data,
      opts: job.opts,
      state,
      progress: job.progress,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
      logs,
      timestamp: job.timestamp,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    };
  }
  
  async close() {
    await this.queue.close();
    await this.queueEvents.close();
  }
}

// Usage
const monitor = new QueueMonitor('my-queue');

monitor.on('completed', async ({ jobId }) => {
  const details = await monitor.getJobDetails(jobId);
  console.log('Job completed:', details);
  // Send notification, update database, etc.
});

monitor.on('failed', async ({ jobId, failedReason }) => {
  const details = await monitor.getJobDetails(jobId);
  console.error('Job failed:', details);
  // Alert on-call, log to error tracking, etc.
});

monitor.on('progress', ({ jobId, data }) => {
  console.log(`Job ${jobId} progress:`, data);
  // Update UI, notify user, etc.
});
```

## Best Practices

### 1. Event Handler Error Handling

Always handle errors in event handlers:

```typescript
queueEvents.on('completed', async ({ jobId }) => {
  try {
    await notifyUser(jobId);
  } catch (err) {
    console.error('Failed to notify user:', err);
    // Don't let notification failures crash the app
  }
});
```

### 2. Resource Cleanup

Clean up event listeners when done:

```typescript
const queueEvents = new QueueEvents('my-queue');

// Use once for one-time events
queueEvents.once('drained', () => {
  console.log('Queue empty');
  queueEvents.close();
});

// Or clean up on shutdown
process.on('SIGTERM', async () => {
  await queueEvents.close();
  process.exit(0);
});
```

### 3. Debouncing High-Frequency Events

```typescript
import { debounce } from 'lodash';

const updateDashboard = debounce((stats) => {
  io.emit('stats', stats);
}, 1000);

queueEvents.on('progress', () => {
  updateDashboard(currentStats);
});
```

### 4. Rate Limiting Events

```typescript
import { RateLimiter } from 'limiter';

const limiter = new RateLimiter({ tokensPerInterval: 10, interval: 'second' });

queueEvents.on('progress', async ({ jobId, data }) => {
  if (await limiter.tryRemoveTokens(1)) {
    io.emit('progress', { jobId, data });
  }
});
```

## Summary

- Use `QueueEvents` for pub/sub style real-time updates
- Report progress with `job.updateProgress()` for long-running jobs
- Build dashboards with WebSockets, SSE, or polling
- Handle errors gracefully in event handlers
- Clean up resources when shutting down
- Consider rate limiting for high-frequency events

For more advanced real-time features like observables and reactive programming, consider [BullMQ Pro](https://docs.bullmq.io/bullmq-pro/observables).
