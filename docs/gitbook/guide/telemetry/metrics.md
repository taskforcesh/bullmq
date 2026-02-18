# Metrics

In addition to traces, BullMQ also supports collecting metrics through OpenTelemetry. Metrics provide quantitative data about your job processing, such as counts of completed/failed jobs and processing durations.

## Enabling Metrics

To enable metrics collection, pass the `enableMetrics` option when creating the `BullMQOtel` instance:

```typescript
import { Queue } from 'bullmq';
import { BullMQOtel } from 'bullmq-otel';

const telemetry = new BullMQOtel({
  tracerName: 'my-app',
  meterName: 'my-app',
  version: '1.0.0',
  enableMetrics: true,
});

const queue = new Queue('myQueue', {
  connection: {
    host: '127.0.0.1',
    port: 6379,
  },
  telemetry,
});
```

```typescript
import { Worker } from 'bullmq';
import { BullMQOtel } from 'bullmq-otel';

const telemetry = new BullMQOtel({
  tracerName: 'my-app',
  meterName: 'my-app',
  version: '1.0.0',
  enableMetrics: true,
});

const worker = new Worker(
  'myQueue',
  async job => {
    return 'some value';
  },
  {
    connection: {
      host: '127.0.0.1',
      port: 6379,
    },
    telemetry,
  },
);
```

## Available Metrics

BullMQ automatically records the following metrics:

### Counters

| Metric Name                    | Description                                                    |
| ------------------------------ | -------------------------------------------------------------- |
| `bullmq.jobs.completed`        | Number of jobs that completed successfully                     |
| `bullmq.jobs.failed`           | Number of jobs that failed (after all retries exhausted)       |
| `bullmq.jobs.delayed`          | Number of jobs moved to delayed state (including retry delays) |
| `bullmq.jobs.retried`          | Number of jobs that were retried immediately                   |
| `bullmq.jobs.waiting`          | Number of jobs moved back to waiting state                     |
| `bullmq.jobs.waiting_children` | Number of jobs moved to waiting-children state                 |

### Histograms

| Metric Name           | Description             | Unit         |
| --------------------- | ----------------------- | ------------ |
| `bullmq.job.duration` | Job processing duration | milliseconds |

### Gauges

| Metric Name               | Description                               | Unit |
| ------------------------- | ----------------------------------------- | ---- |
| `bullmq.queue.jobs.count` | Current count of jobs in queue (by state) | jobs |

Gauges are recorded when calling queue getter methods like `count()` or `getJobCounts()`. The `bullmq.queue.jobs.count` gauge includes a `bullmq.queue.jobs.state` attribute indicating which job state was counted (e.g., `waiting`, `active`, `completed`, `failed`, `delayed`, `prioritized`, `paused`, `waiting-children`).

## Metric Attributes

All metrics include the following attributes for filtering and grouping:

| Attribute                 | Description                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `bullmq.queue.name`       | Name of the queue                                                                  |
| `bullmq.job.name`         | Name of the job                                                                    |
| `bullmq.job.status`       | Status of the job (completed, failed, delayed, retried, waiting, waiting-children) |
| `bullmq.queue.jobs.state` | Job state for gauge metrics (waiting, active, completed, failed, etc.)             |

## Configuration Options

The `BullMQOtel` constructor accepts the following options:

```typescript
interface BullMQOtelOptions {
  /**
   * Name for the tracer (default: 'bullmq')
   */
  tracerName?: string;

  /**
   * Name for the meter (default: 'bullmq')
   */
  meterName?: string;

  /**
   * Version string for both tracer and meter
   */
  version?: string;

  /**
   * Enable metrics collection. When true, a meter will be created
   * to record job metrics like completed/failed counts and durations.
   * @default false
   */
  enableMetrics?: boolean;
}
```

## Custom Metric Options

BullMQOtel allows you to pre-configure counters, histograms, and gauges with custom options before passing the telemetry instance to a Worker or Queue. Once a metric is created with custom options, BullMQ will reuse it and the default options defined internally will be ignored.

This is useful when you want to customize metric descriptions, units, or other OpenTelemetry metric options:

```typescript
import { BullMQOtel } from 'bullmq-otel';
import { Queue, Worker } from 'bullmq';

const telemetry = new BullMQOtel({
  tracerName: 'my-app',
  meterName: 'my-app',
  version: '1.0.0',
  enableMetrics: true,
});

// Pre-configure a counter with custom options
// This will be reused by BullMQ, ignoring its default options
telemetry.meter.createCounter('bullmq.jobs.completed', {
  description: 'Custom description for completed jobs',
  unit: '1',
});

// Pre-configure the duration histogram with custom options
telemetry.meter.createHistogram('bullmq.job.duration', {
  description: 'Custom job processing duration',
  unit: 's', // Using seconds instead of default milliseconds
});

// Pre-configure a gauge for queue job counts
telemetry.meter.createGauge('bullmq.queue.jobs.count', {
  description: 'Current number of jobs in the queue by state',
  unit: 'jobs',
});

const queue = new Queue('myQueue', {
  connection: {
    host: '127.0.0.1',
    port: 6379,
  },
  telemetry,
});

const worker = new Worker(
  'myQueue',
  async job => {
    return 'some value';
  },
  {
    connection: {
      host: '127.0.0.1',
      port: 6379,
    },
    telemetry,
  },
);

// When calling count() or getJobCounts(), gauge metrics are recorded
const waitingCount = await queue.count();
const jobCounts = await queue.getJobCounts();
```

{% hint style="info" %}
The `BullMQOTelMeter` caches all created counters, histograms, and gauges by name. When BullMQ internally calls `createCounter`, `createHistogram`, or `createGauge` with the same name, the cached instance is returned, effectively ignoring the default options passed by BullMQ.
{% endhint %}

## Backward Compatibility

The original constructor signature is still supported for backward compatibility:

```typescript
// Old style (traces only)
const telemetry = new BullMQOtel('my-app', '1.0.0');

// New style with options object (traces + optional metrics)
const telemetry = new BullMQOtel({
  tracerName: 'my-app',
  version: '1.0.0',
  enableMetrics: true,
});
```

## Exporting Metrics

To export metrics to an observability backend, you need to configure an OpenTelemetry metrics exporter. Here's an example using the OTLP exporter:

```typescript
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { metrics } from '@opentelemetry/api';

// Configure the metrics exporter
const metricExporter = new OTLPMetricExporter({
  url: 'http://localhost:4318/v1/metrics',
});

const meterProvider = new MeterProvider({
  readers: [
    new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 10000, // Export every 10 seconds
    }),
  ],
});

// Set the global meter provider
metrics.setGlobalMeterProvider(meterProvider);

// Now create your BullMQ instances with metrics enabled
const telemetry = new BullMQOtel({
  tracerName: 'my-app',
  enableMetrics: true,
});
```

{% hint style="info" %}
Make sure to set up the meter provider before creating BullMQ instances with telemetry enabled.
{% endhint %}
