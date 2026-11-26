---
description: >-
  How to use BullMQ Pro in a NestJS application with the
  @taskforcesh/nestjs-bullmq-pro module: register queues, write processors
  (workers), add jobs from your services and listen to queue events.
---

# BullMQ Pro with NestJS

BullMQ Pro integrates with [NestJS](https://nestjs.com) through `@taskforcesh/nestjs-bullmq-pro`, a module based on [@nestjs/bullmq](https://www.npmjs.com/package/@nestjs/bullmq) that registers the BullMQ Pro classes, so that your processors and services can use groups, batches and the other Pro features. If you use the open source version of BullMQ, see [BullMQ with NestJS](../../guide/nestjs/README.md).

## Installation

```bash
yarn add @taskforcesh/nestjs-bullmq-pro
```

{% hint style="info" %}
BullMQ-Pro needs a token, as explained in the [install](https://docs.bullmq.io/bullmq-pro/install) section.
{% endhint %}

Once the installation process is complete, we can import the `BullModule` into the root `AppModule`.

```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@taskforcesh/nestjs-bullmq-pro';

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

To register a queue, import the `BullModule.registerQueue()` dynamic module, as follows:

```typescript
BullModule.registerQueue({
  name: 'queueName',
});
```

To register a flow producer, import the `BullModule.registerFlowProducer()` dynamic module, as follows:

```typescript
BullModule.registerFlowProducer({
  name: 'flowProducerName',
});
```

## Processors

To register a processor, you may need to use `Processor` decorator:

```typescript
import {
  Processor,
  WorkerHost,
  OnWorkerEvent,
} from '@taskforcesh/nestjs-bullmq-pro';
import { JobPro } from '@taskforcesh/bullmq-pro';

@Processor('queueName')
class TestProcessor extends WorkerHost {
  async process(job: JobPro<any, any, string>): Promise<any> {
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

## Example

A working example is available [here](https://github.com/taskforcesh/nestjs-bullmq-pro-example).

## Read more

- 💡 [Queues Technique](https://docs.nestjs.com/techniques/queues)
- 💡 [Register Queue API Reference](https://nestjs.bullmq.pro/classes/BullModule.html#registerQueue)
- 💡 [Register Flow Producer API Reference](https://nestjs.bullmq.pro/classes/BullModule.html#registerFlowProducer)
- 💡 [Worker Listener API Reference](https://docs.bullmq.io/api/interfaces/v6.WorkerListener.html)
