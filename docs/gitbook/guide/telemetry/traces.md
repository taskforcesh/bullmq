# Traces

BullMQ provides comprehensive distributed tracing support through OpenTelemetry. Traces allow you to track the flow of jobs through your system, identify bottlenecks, and debug issues across distributed services.

## Enabling Traces

To enable tracing, pass a telemetry instance when creating Queue, Worker, or FlowProducer:

```typescript
import { Queue, Worker } from 'bullmq';
import { BullMQOtel } from 'bullmq-otel';

const telemetry = new BullMQOtel({
  tracerName: 'my-app',
  version: '1.0.0',
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
```

## Span Kinds

BullMQ uses different span kinds to categorize operations:

| Span Kind  | Description                                                         |
| ---------- | ------------------------------------------------------------------- |
| `PRODUCER` | Operations that add jobs to a queue (producing work)                |
| `CONSUMER` | Operations that process jobs from a queue (consuming work)          |
| `INTERNAL` | Internal operations like pausing, resuming, or managing queue state |

## Available Traces

BullMQ automatically creates spans for the following operations:

### Queue Class

| Operation                | Span Name                            | Span Kind | Description                          |
| ------------------------ | ------------------------------------ | --------- | ------------------------------------ |
| `add`                    | `{queueName}.add`                    | PRODUCER  | Adding a single job to the queue     |
| `addBulk`                | `{queueName}.addBulk`                | PRODUCER  | Adding multiple jobs to the queue    |
| `pause`                  | `{queueName}.pause`                  | INTERNAL  | Pausing the queue                    |
| `resume`                 | `{queueName}.resume`                 | INTERNAL  | Resuming the queue                   |
| `close`                  | `{queueName}.close`                  | INTERNAL  | Closing the queue connection         |
| `rateLimit`              | `{queueName}.rateLimit`              | INTERNAL  | Setting rate limit on the queue      |
| `removeRepeatable`       | `{queueName}.removeRepeatable`       | INTERNAL  | Removing a repeatable job by options |
| `removeRepeatableByKey`  | `{queueName}.removeRepeatableByKey`  | INTERNAL  | Removing a repeatable job by key     |
| `removeDebounceKey`      | `{queueName}.removeDebounceKey`      | INTERNAL  | Removing a debounce key              |
| `removeDeduplicationKey` | `{queueName}.removeDeduplicationKey` | INTERNAL  | Removing a deduplication key         |
| `remove`                 | `{queueName}.remove`                 | INTERNAL  | Removing a job from the queue        |
| `updateJobProgress`      | `{queueName}.updateJobProgress`      | INTERNAL  | Updating job progress                |
| `drain`                  | `{queueName}.drain`                  | INTERNAL  | Draining the queue                   |
| `clean`                  | `{queueName}.clean`                  | INTERNAL  | Cleaning jobs from the queue         |
| `obliterate`             | `{queueName}.obliterate`             | INTERNAL  | Obliterating the queue (all data)    |
| `retryJobs`              | `{queueName}.retryJobs`              | PRODUCER  | Retrying failed jobs                 |
| `promoteJobs`            | `{queueName}.promoteJobs`            | INTERNAL  | Promoting delayed jobs               |
| `trimEvents`             | `{queueName}.trimEvents`             | INTERNAL  | Trimming events from the queue       |

### Worker Class

| Operation                | Span Name                            | Span Kind | Description                            |
| ------------------------ | ------------------------------------ | --------- | -------------------------------------- |
| `getNextJob`             | `{queueName}.getNextJob`             | INTERNAL  | Fetching the next job to process       |
| `rateLimit`              | `{queueName}.rateLimit`              | INTERNAL  | Worker rate limiting                   |
| `processJob`             | `{queueName}.{jobName}`              | CONSUMER  | Processing a job (main processor span) |
| `pause`                  | `{queueName}.pause`                  | INTERNAL  | Pausing the worker                     |
| `resume`                 | `{queueName}.resume`                 | INTERNAL  | Resuming the worker                    |
| `close`                  | `{queueName}.close`                  | INTERNAL  | Closing the worker                     |
| `startStalledCheckTimer` | `{queueName}.startStalledCheckTimer` | INTERNAL  | Starting stalled job check timer       |
| `moveStalledJobsToWait`  | `{queueName}.moveStalledJobsToWait`  | INTERNAL  | Moving stalled jobs back to waiting    |
| `extendLocks`            | `{queueName}.extendLocks`            | INTERNAL  | Extending locks on active jobs         |

### Job Class

| Operation         | Span Name              | Span Kind | Description                                      |
| ----------------- | ---------------------- | --------- | ------------------------------------------------ |
| `moveToCompleted` | `{queueName}.complete` | INTERNAL  | Completing a job successfully                    |
| `moveToFailed`    | `{queueName}.{state}`  | INTERNAL  | Job failure handling (state: fail, delay, retry) |

### JobScheduler Class

| Operation | Span Name                        | Span Kind | Description               |
| --------- | -------------------------------- | --------- | ------------------------- |
| `add`     | `{queueName}.upsertJobScheduler` | PRODUCER  | Upserting a job scheduler |

### FlowProducer Class

| Operation | Span Name             | Span Kind | Description                        |
| --------- | --------------------- | --------- | ---------------------------------- |
| `add`     | `{queueName}.addFlow` | PRODUCER  | Adding a flow (tree of jobs)       |
| `addBulk` | `addBulkFlows`        | PRODUCER  | Adding multiple flows              |
| `addNode` | `{queueName}.addNode` | PRODUCER  | Adding a node in a flow (internal) |

## Trace Attributes

Traces include various attributes for filtering and debugging:

### Common Attributes

| Attribute       | Key                      | Description                       |
| --------------- | ------------------------ | --------------------------------- |
| Queue Name      | `bullmq.queue.name`      | Name of the queue                 |
| Queue Operation | `bullmq.queue.operation` | Type of operation being performed |

### Job Attributes

| Attribute               | Key                                     | Description                                    |
| ----------------------- | --------------------------------------- | ---------------------------------------------- |
| Job Name                | `bullmq.job.name`                       | Name of the job                                |
| Job ID                  | `bullmq.job.id`                         | Unique identifier of the job                   |
| Job Key                 | `bullmq.job.key`                        | Redis key of the job                           |
| Job IDs                 | `bullmq.job.ids`                        | Multiple job IDs (bulk ops)                    |
| Job Options             | `bullmq.job.options`                    | Serialized job options                         |
| Job Progress            | `bullmq.job.progress`                   | Current job progress value                     |
| Job Type                | `bullmq.job.type`                       | Type/state of the job                          |
| Job Attempts Made       | `bullmq.job.attempts.made`              | Number of attempts made                        |
| Job Result              | `bullmq.job.result`                     | Result returned by the job                     |
| Job Failed Reason       | `bullmq.job.failed.reason`              | Reason for job failure                         |
| Job Attempt Finished    | `bullmq.job.attempt_finished_timestamp` | When the processing attempt ended              |
| Job Finished Timestamp  | `bullmq.job.finished.timestamp`         | When the processing attempt ended (deprecated) |
| Job Processed Timestamp | `bullmq.job.processed.timestamp`        | When the job was processed                     |
| Deduplication Key       | `bullmq.job.deduplication.key`          | Deduplication key if set                       |

### Bulk Operation Attributes

| Attribute  | Key                     | Description                      |
| ---------- | ----------------------- | -------------------------------- |
| Bulk Count | `bullmq.job.bulk.count` | Number of jobs in bulk operation |
| Bulk Names | `bullmq.job.bulk.names` | Comma-separated job names        |

### Worker Attributes

| Attribute            | Key                                  | Description                     |
| -------------------- | ------------------------------------ | ------------------------------- |
| Worker Name          | `bullmq.worker.name`                 | Name of the worker              |
| Worker ID            | `bullmq.worker.id`                   | Unique identifier of the worker |
| Worker Options       | `bullmq.worker.options`              | Serialized worker options       |
| Worker Rate Limit    | `bullmq.worker.rate.limit`           | Rate limit duration             |
| Do Not Wait Active   | `bullmq.worker.do.not.wait.active`   | Whether to wait for active jobs |
| Force Close          | `bullmq.worker.force.close`          | Whether closing is forced       |
| Stalled Jobs         | `bullmq.worker.stalled.jobs`         | Number of stalled jobs detected |
| Failed Jobs          | `bullmq.worker.failed.jobs`          | Number of failed stalled jobs   |
| Jobs to Extend Locks | `bullmq.worker.jobs.to.extend.locks` | Jobs needing lock extension     |

### Queue Operation Attributes

| Attribute        | Key                             | Description                 |
| ---------------- | ------------------------------- | --------------------------- |
| Drain Delay      | `bullmq.queue.drain.delay`      | Whether to delay drain      |
| Grace Period     | `bullmq.queue.grace`            | Grace period for clean op   |
| Clean Limit      | `bullmq.queue.clean.limit`      | Maximum jobs to clean       |
| Rate Limit       | `bullmq.queue.rate.limit`       | Rate limit settings         |
| Queue Options    | `bullmq.queue.options`          | Serialized queue options    |
| Event Max Length | `bullmq.queue.event.max.length` | Maximum event stream length |

### Flow Attributes

| Attribute | Key                | Description      |
| --------- | ------------------ | ---------------- |
| Flow Name | `bullmq.flow.name` | Name of the flow |

### Scheduler Attributes

| Attribute        | Key                       | Description             |
| ---------------- | ------------------------- | ----------------------- |
| Job Scheduler ID | `bullmq.job.scheduler.id` | ID of the job scheduler |

## Context Propagation

BullMQ automatically propagates trace context when jobs are added and processed. This allows you to track jobs across services:

1. **Producer side**: When adding a job, the trace context is captured and stored with the job data
2. **Consumer side**: When processing a job, the trace context is extracted and used to continue the trace

### Controlling Context Propagation

You can control context propagation per job using the `telemetry` job option:

```typescript
// Include trace context (default behavior)
await queue.add('job', data);

// Explicitly include context
await queue.add('job', data, {
  telemetry: {
    omitContext: false,
  },
});

// Omit trace context (start fresh trace when processing)
await queue.add('job', data, {
  telemetry: {
    omitContext: true,
  },
});

// Provide custom metadata
await queue.add('job', data, {
  telemetry: {
    metadata: customContextData,
  },
});
```

## Exporting Traces

To export traces to an observability backend, configure an OpenTelemetry trace exporter:

```typescript
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { trace } from '@opentelemetry/api';

// Configure the trace exporter
const traceExporter = new OTLPTraceExporter({
  url: 'http://localhost:4318/v1/traces',
});

const provider = new NodeTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(traceExporter));
provider.register();

// Now BullMQOtel will automatically use the registered provider
```

## Example Trace Visualization

When properly configured, you can see traces in your observability platform showing the complete lifecycle of jobs:

```
├─ myQueue.add (PRODUCER)
│  └─ myQueue.myJob (CONSUMER)
│     └─ myQueue.complete (INTERNAL)
```

For flows with parent-child relationships:

```
├─ myQueue.addFlow (PRODUCER)
│  ├─ childQueue.addNode (PRODUCER)
│  │  └─ childQueue.childJob (CONSUMER)
│  │     └─ childQueue.complete (INTERNAL)
│  └─ parentQueue.addNode (PRODUCER)
│     └─ parentQueue.parentJob (CONSUMER)
│        └─ parentQueue.complete (INTERNAL)
```
