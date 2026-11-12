---
description: >-
  How to use BullMQ in a NestJS application with the @nestjs/bullmq module:
  register queues, write processors (workers), add jobs from your services and
  listen to queue events.
---

# BullMQ with NestJS

BullMQ integrates with [NestJS](https://nestjs.com) through [`@nestjs/bullmq`](https://www.npmjs.com/package/@nestjs/bullmq), a module maintained by the NestJS team. Queues, flow producers, workers (called processors in NestJS) and queue event listeners are registered in your modules and injected like any other provider.

This page covers the setup and the processors. See also:

- [Producers](producers.md), to add jobs and flows from your services.
- [Queue Events Listeners](queue-events-listeners.md), to react to the events of a queue.
- [BullMQ Pro with NestJS](../../bullmq-pro/nestjs/README.md), if you use groups, batches or other BullMQ Pro features.
- A [working example](https://github.com/taskforcesh/nestjs-bullmq-example) on GitHub.

## Installation

```bash
npm i @nestjs/bullmq bullmq
```

Once the installation process is complete, we can import the **`BullModule`** into the root **`AppModule`**.

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: 'localhost',
        port: 6379,
      },
    }),
  ],
})
export class AppModule {}
```

To register a queue, import the **`BullModule.registerQueue()`** dynamic module, as follows:

```typescript
BullModule.registerQueue({
  name: 'queueName',
});
```

To register a flow producer, import the **`BullModule.registerFlowProducer()`** dynamic module, as follows:

```typescript
BullModule.registerFlowProducer({
  name: 'flowProducerName',
});
```

## Processors

To register a processor, you may need to use the **`Processor`** decorator:

```typescript
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';

@Processor('queueName')
class TestProcessor extends WorkerHost {
  async process(job: Job<any, any, string>): Promise<any> {
    // do some stuff
  }

  @OnWorkerEvent('completed')
  onCompleted() {
    // do some stuff
  }
}
```

And then register it as a provider:

```typescript
@Module({
  imports: [
    BullModule.registerQueue({
      name: 'queueName',
      connection: {
        host: '0.0.0.0',
        port: 6380,
      },
    }),
    BullModule.registerFlowProducer({
      name: 'flowProducerName',
      connection: {
        host: '0.0.0.0',
        port: 6380,
      },
    }),
  ],
  providers: [TestProcessor],
})
export class AppModule {}
```

## Read more

- 💡 [Queues Technique](https://docs.nestjs.com/techniques/queues)
