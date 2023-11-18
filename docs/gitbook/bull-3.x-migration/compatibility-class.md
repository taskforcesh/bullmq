# Compatibility class

The `Queue3` class is targeted to simplify migration of projects based on Bull 3. Though it does not offer 100% API and functional compatibility, upgrading to BullMQ with this class should be easier for users familiar with Bull 3.

Differences in interface include

* fixed order of `add()` and `process()` method arguments
* class instantiation requires use of the `new` operator
* interfaces for Queue and Job options and Job class do not have wrappers and are used directly
* there's no `done` argument expected in `process()` callback anymore; now the callback must always return a `Promise` object
* name property is mandatory in `add()` method
* concurrency is moved from `process()` argument to queue options

Functional differences generally include only the absence of named processors feature and minor changes in local and global events set. The mandatory `name` property in `add()` method can contain any string and gets saved to Redis as is. When a job is in progress, you can read this value using `job.name` \(`job.data` and `job.id` are available as usual\). See the \[link\] for details.

The all-in-one example:

```typescript
import { Job } from "bullmq";
import { Queue3 } from "bullmq/dist/classes/compat";

const queue = new Queue3("animals", { concurrency: 1 });

queue.process(async (job: Job) => {
   return `${job.name}s ${job.data.sound}ing`;
});

queue.on("completed", (job: Job, result: any) => {
   console.log(`Job ${job.id} is completed with result: ${result}`);
});

queue.add("cat", { sound: "meow" });
queue.add("cow", { sound: "moo" });
queue.add("dog", { sound: "bark" });
```

## Read more:

- 💡 [Queue3 API Reference](https://api.docs.bullmq.io/classes/v1.Queue3.html)
