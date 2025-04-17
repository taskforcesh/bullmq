# Getting started

In this guide we will show how to setup a local telemetry facility for BullMQ that should serve you as a good basis for how to integrate it in larger applications. As OpenTelemetry is a well supported standard there are many third party UIs for visualizing the traces and spans generated when running an application, for this guide we will use [Jaeger](https://www.jaegertracing.io).

We assume that you have a working BullMQ project that you want to add telemetry to it, so lets start by adding the `bullmq-otel` package to the project:

```
npm add --save bullmq-otel
```

This module provides a working implementation of BullMQ's telemetry interface for the OpenTelemetry standard. Adding it to your existing Queue's instances and Workers is quite straightforward:

```typescript
import { Queue } from 'bullmq'
import { BullMQOtel } from "bullmq-otel";

const queue = new Queue("myQueue", {
  connection: {
    host: "127.0.0.1",
    port: 6379,
  },
  telemetry: new BullMQOtel("simple-guide"),
});
```

```typescript
import { Worker } from "bullmq";
import { BullMQOtel } from "bullmq-otel";

const worker = new Worker(
  "myQueue",
  async (job) => {
    return 'some value'
  },
  {
    name: "myWorker",
    connection: {
      host: "127.0.0.1",
      port: 6379,
    },
    telemetry: new BullMQOtel("simple-guide"),
  }
);
```

This is all that is needed in order to start producing traces and spans to observe your code.
