# Live job progress

**Scenario:** users upload videos, a fleet of workers transcodes them, and the
web page of each video shows a live progress bar. The user's browser is
connected to one of your API servers (through Server-Sent Events), while the
job runs on any worker.

The worker publishes the progress of each job on its own topic, as a
[retained message](../retained-messages.md). The API server that has a user
watching a video subscribes to that job's topics only, and gets the current
progress at once when the page opens.

## Worker

```typescript
import { Relay, Worker } from 'bullmq';

const connection = { host: 'redis.internal', port: 6379 };
const relay = new Relay({ connection });

const HOUR = 60 * 60 * 1000;

const topic = (jobId: string, kind: 'progress' | 'status') =>
  `jobs.transcode.${jobId}.${kind}`;

const worker = new Worker(
  'transcode',
  async job => {
    const chunks = await splitVideo(job.data.videoUrl);
    for (const [index, chunk] of chunks.entries()) {
      await transcode(chunk);
      const progress = Math.round(((index + 1) / chunks.length) * 100);
      await relay.publish(topic(job.id!, 'progress'), progress, {
        retain: HOUR,
      });
    }
    return { url: await mergeChunks(chunks) };
  },
  { connection },
);

worker.on('completed', (job, result) =>
  relay.publish(
    topic(job.id!, 'status'),
    { state: 'completed', url: result.url },
    { retain: 24 * HOUR },
  ),
);

worker.on('failed', (job, err) => {
  if (job) {
    relay.publish(
      topic(job.id!, 'status'),
      { state: 'failed', reason: err.message },
      { retain: 24 * HOUR },
    );
  }
});
```

## API server

```typescript
import express from 'express';
import { Relay } from 'bullmq';

const relay = new Relay({ connection: { host: 'redis.internal', port: 6379 } });
const app = express();

app.get('/videos/:jobId/events', async (req, res) => {
  const { jobId } = req.params;
  if (!/^\d+$/.test(jobId) || !(await userCanSeeJob(req.user, jobId))) {
    return res.sendStatus(404);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // Two exact topics (not `jobs.transcode.${jobId}.>`), so each delivers its
  // retained value first: the page shows the current state immediately.
  const subscriptions = await Promise.all([
    relay.subscribe(`jobs.transcode.${jobId}.progress`, m =>
      send('progress', m.data),
    ),
    relay.subscribe(`jobs.transcode.${jobId}.status`, m =>
      send('status', m.data),
    ),
  ]);

  req.on('close', () => {
    subscriptions.forEach(subscription => subscription.unsubscribe());
  });
});
```

In the browser:

```typescript
const events = new EventSource(`/videos/${jobId}/events`);
events.addEventListener(
  'progress',
  e => (progressBar.value = JSON.parse(e.data)),
);
events.addEventListener('status', e => showResult(JSON.parse(e.data)));
```

## Why the Relay

- **Only the API servers with a viewer receive updates**, and only for the
  jobs being watched. With `QueueEvents`, every API server would read every
  event of the queue.
- **Opening the page shows the current progress at once** thanks to retained
  messages, without querying the job.
- **It works the same with any number of API servers and workers.**

## Things to watch

- Validate and authorize the job id before building a topic from it (see
  [Values in topics](../topics-and-patterns.md#values-in-topics)).
- Publishing progress on every tiny step is wasteful: publish when the
  percentage changes, or at most a few times per second.
- If you also need the progress on the job itself (for example for
  `queue.getJob(id)`), keep calling `job.updateProgress()` as well.
