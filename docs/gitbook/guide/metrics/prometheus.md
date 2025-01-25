---
description: How to use the built-in prometheus exporter
---

# Prometheus

BullMQ provides a simple API that can be used to export metrics to Prometheus. You just need to create an endpoint in your webserver that calls exportPrometheusMetrics() and configure prometheus to consume from this endpoint. For example using vanilla NodeJS:

```typescript
import http from 'http';
import { Queue } from 'bullmq';

const queue = new Queue('my-queue');

const server = http.createServer(
  async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      if (req.url === '/metrics' && req.method === 'GET') {
        const metrics = await queue.exportPrometheusMetrics();

        res.writeHead(200, {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(metrics),
        });
        res.end(metrics);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    } catch (err: unknown) {
      res.writeHead(500);
      res.end(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  },
);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Prometheus metrics server running on port ${PORT}`);
  console.log(`Metrics available at http://localhost:${PORT}/metrics`);
});
```

If you curl to the endpoint like this:&#x20;

```bash
curl http://localhost:3000/metrics
```

You will get an output similar to this:

```
HELP bullmq_job_count Number of jobs in the queue by state
TYPE bullmq_job_count gauge
bullmq_job_count{queue="my-queue", state="waiting"} 5
bullmq_job_count{queue="my-queue", state="active"} 3
bullmq_job_count{queue="my-queue", state="completed"} 12
bullmq_job_count{queue="my-queue", state="failed"} 2
```

If you use ExpressJS the code is a bit simpler:

```typescript
import express from 'express';
import { Queue } from './src/queue';

const app = express();
const queue = new Queue('my-queue');

app.get('/metrics', async (req, res) => {
  try {
    const metrics = await queue.exportPrometheusMetrics();
    res.set('Content-Type', 'text/plain');
    res.send(metrics);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Prometheus metrics server running on port ${PORT}`);
  console.log(`Metrics available at http://localhost:${PORT}/metrics`);
});
```

## Read more:

- 💡 [Export Prometheus Metrics API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#exportPrometheusMetrics)
