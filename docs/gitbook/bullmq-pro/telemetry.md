# Telemetry

In the same fashion we support telemetry in BullMQ open source edition, we also support telemetry for BullMQ Pro. It works basically the same, in fact you can just the same integrations available for BullMQ in the Pro version. So in order to enable it you would do something like this:

```typescript
import { QueuePro } from "@taskforcesh/bullmq-pro";
import { BullMQOtel } from "bullmq-otel";

// Initialize a Pro queue using BullMQ-Otel
const queue = new QueuePro("myProQueue", {
  connection,
  telemetry: new BullMQOtel("guide"),
});

await queue.add(
  "myJob",
  { data: "myData" },
  {
    attempts: 2,
    backoff: 1000,
    group: {
      id: "myGroupId",
    },
  }
);
```

For the Worker we will do it in a similar way:

```typescript
import { WorkerPro } from "@taskforcesh/bullmq-pro";
import { BullMQOtel } from "bullmq-otel";

const worker = new WorkerPro(
  "myProQueue",
  async (job) => {
    console.log("processing job", job.id);
  },
  {
    name: "myWorker",
    connection,
    telemetry: new BullMQOtel("guide"),
    concurrency: 10,
    batch: { size: 10 },
  }
);
```

For an introductury guide on how to integrate OpenTelemetry in you BullMQ applications take a look at this tutorial: [https://blog.taskforce.sh/how-to-integrate-bullmqs-telemetry-on-a-newsletters-subscription-application-2/](https://blog.taskforce.sh/how-to-integrate-bullmqs-telemetry-on-a-newsletters-subscription-application-2/)
