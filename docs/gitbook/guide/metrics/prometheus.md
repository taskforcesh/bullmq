---
description: How to use the built-in prometheus exporter
---

# Prometheus

BullMQ provides a simple API to export metrics to Prometheus. To use it, create an endpoint in your web server that calls `exportPrometheusMetrics()`, and configure Prometheus to scrape metrics from this endpoint.

#### Basic Usage

Below is an example using vanilla Node.js:

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

Test the endpoint with:

```bash
curl http://localhost:3000/metrics
```

This will return an output like:

```
HELP bullmq_job_count Number of jobs in the queue by state
TYPE bullmq_job_count gauge
bullmq_job_count{queue="my-queue", state="waiting"} 5
bullmq_job_count{queue="my-queue", state="active"} 3
bullmq_job_count{queue="my-queue", state="completed"} 12
bullmq_job_count{queue="my-queue", state="failed"} 2
```

For a simpler setup with Express.js:

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

#### Advanced Usage: Adding Global Variables as Labels

The `exportPrometheusMetrics` function also supports an optional globalVariables parameter. This allows you to include additional labels (e.g., env, server) in your metrics, which is particularly useful when aggregating metrics from multiple environments (like production or staging) in tools like Grafana. The globalVariables parameter accepts a record of key-value pairs that are added as labels to each metric.

#### Example with Global Variables

Here’s how to use this feature in vanilla Node.js:

```typescript
import http from 'http';
import { Queue } from 'bullmq';

const queue = new Queue('my-queue');

const server = http.createServer(
  async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      if (req.url === '/metrics' && req.method === 'GET') {
        const globalVariables = { env: 'Production', server: '1' };
        const metrics = await queue.exportPrometheusMetrics(globalVariables);

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

With globalVariables = { env: 'Production', server: '1' }, the output becomes:

```plaintext
# HELP bullmq_job_count Number of jobs in the queue by state
# TYPE bullmq_job_count gauge
bullmq_job_count{queue="my-queue", state="waiting", env="Production", server="1"} 5
bullmq_job_count{queue="my-queue", state="active", env="Production", server="1"} 3
bullmq_job_count{queue="my-queue", state="completed", env="Production", server="1"} 12
bullmq_job_count{queue="my-queue", state="failed", env="Production", server="1"} 2
```

These additional labels allow you to filter and group metrics in Prometheus or Grafana, making it easier to distinguish between different environments or servers.

## Read more:

- 💡 [Export Prometheus Metrics API Reference](https://api.docs.bullmq.io/classes/v5.Queue.html#exportprometheusmetrics)
