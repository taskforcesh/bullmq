# Running a simple example

### Creating a producer

For this simple example we will create a producer that will add a couple of jobs, but it will add them in bulks instead of one by one, this will help us demonstrate how spans are linked between the consumers and the producers:

{% code title="producer.ts" %}
```typescript
import { Queue } from "bullmq";
import { BullMQOtel } from "bullmq-otel";

const queue = new Queue("myQueue", {
  connection: {
    host: "127.0.0.1",
    port: 6379,
  },
  telemetry: new BullMQOtel("simple-guide"),
});

const jobsBulk = Array.from({ length: 5 }, (_, i) => i);

(async () => {
  for (let i = 0; i < 10; i++) {
    await queue.addBulk(
      jobsBulk.map((j) => ({
        name: `myJob ${j}`,
        data: { i: j },
        opts: { attempts: 2, backoff: 1000 },
      }))
    );
  }
})();
```
{% endcode %}

### Creating a consumer

The consumer will be just a simple instance, we will use concurrency 10, so that jobs can be processed concurrently, and therefore create overlapping spans. We will also simulate jobs failures so that we can get retries, to show how spans are generated as the job gets failed, retried and finally completed:

{% code title="consumer.ts" %}
```typescript
import { Worker } from "bullmq";
import { BullMQOtel } from "bullmq-otel";

(async () => {
  const worker = new Worker(
    "myQueue",
    async (job) => {
      console.log("processing job", job.id, job.attemptsMade);
      await new Promise(async (res) => {
        setTimeout(() => res({}), 200);
      });

      if (job.attemptsMade < 1) {
        throw new Error("This was an error");
      }

      return "my result value";
    },
    {
      name: "myWorker",
      connection: {
        host: "127.0.0.1",
        port: 6379,
      },
      telemetry: new BullMQOtel("simple-guide"),
      concurrency: 10,
    }
  );
})();
```
{% endcode %}

### Creating the instrumentation files

To test the telemetry functionality we can run a simple example. For that we also need to instantiate the OpenTelemetry SDK using a so called OpenTelemetry Protocol (OTLP) exporter.

We must install the following modules that are part of the OpenTelemetry SDK:

```
npm install @opentelemetry/exporter-trace-otlp-proto \
  @opentelemetry/exporter-metrics-otlp-proto
```

And now we must create so called "instrumentation" files. We will create one for our "producer" service, which is the service actually taking care of producing jobs, it will look like this. Note that we use localhost (127.0.0.1) where our jaeger service is running:

{% code title="producer.inst.otlp.ts" %}
```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

const sdk = new NodeSDK({
  serviceName: 'producer',
  traceExporter: new OTLPTraceExporter({
    url: 'http://127.0.0.1:4318/v1/traces'
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: 'http://127.0.0.1:4318/v1/metrics'
    }),
  }),
});

sdk.start();
```
{% endcode %}

Likewise we will create another instrumentation file for our "consumer" service, this is where the workers will run and consume the jobs produced by the "Queue" instance:

{% code title="consumer.inst.otlp.ts" %}
```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';

const sdk = new NodeSDK({
  serviceName: 'consumer',
  traceExporter: new OTLPTraceExporter({
    url: 'http://127.0.0.1:4318/v1/traces'
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: 'http://127.0.0.1:4318/v1/metrics'
    }),
  }),
});

sdk.start();
```
{% endcode %}

Both services looks basically the same, just the service name will differ in this case.

### Launching the services

In order to guarantee that the OpenTelemetry instrumentation is run first, before everything else, and performs any required internal patching (even though BullMQ does not rely on patching other modules may do), we need to launch it like this (note that we use tsx in this example but Node runtime will do as well:

```
tsx --import producer.inst.otlp.ts producer.ts
tsx --import consumer.inst.otlp.ts consumer.ts
```

{% hint style="info" %}
You can also use Node runtime directly if you are using javascript (or building from Typescript to javascript): `node --import producer.inst.otlp.js producer.js`
{% endhint %}

As the services are launched we will see that the consumers starts processing the jobs and produce some logs on the console:

```
> tsx --import consumer.inst.otlp.ts consumer.ts

processing job 1 0
processing job 2 0
processing job 3 0
processing job 4 0
processing job 5 0
processing job 6 0
...
processing job 43 1
processing job 44 1
processing job 45 1
processing job 46 1
processing job 47 1
processing job 48 1
processing job 49 1
processing job 50 1
```

These are just the logs that we wrote ourselves on the "process" function in our worker, so nothing special here. However if we go to Jaeger we will find the following:

<figure><img src="../../.gitbook/assets/image (6).png" alt=""><figcaption></figcaption></figure>

We have now 2 services to choose from, consumer and producer. If we search for traces in the producer we will be able to see all the traces where the producer is involved:

<figure><img src="../../.gitbook/assets/image (8).png" alt=""><figcaption></figcaption></figure>

Here we can see as even though we are searching for the producer traces, we also get the consumer spans, and this is because jobs are linked between producers and consumers, so that we can trace all the way from the creation of a job to its final processing.

If we look into the consumer spans for example, there are some interesting things to see:

<figure><img src="../../.gitbook/assets/image (9).png" alt=""><figcaption></figcaption></figure>

First of all, note how the producer span "addBulk myQueue", is the root of this trace. Since this was an addBulk, it means that several jobs were added to the queue in one go, 5 in this case. So the spans created by the consumer are therefore linked to this one producer span. The consumer spans "process myQueue" are generated for every job that is being processed, and since we had a concurrency factor larger than 5, all 5 jobs are processed concurrently, which we can see in the spans all starting at the same time.

But we also forced the jobs to fail 1 time, so that they would be retried with a small backoff (delay), which is why we can see a "delay myQueue" span and then a final "process myQueue" span.

If we open the spans we can find other useful information:

<figure><img src="../../.gitbook/assets/image (10).png" alt=""><figcaption></figcaption></figure>

We have some useful tags related to this particular job, and also logs that shows events that happened during the span lifetime, for instance here we can see that the job failed with the given error message.

If we go to the last span of the trace we can see that the job was finally completed after being delayed a bit before its last retry:

<figure><img src="../../.gitbook/assets/image (11).png" alt=""><figcaption></figcaption></figure>
