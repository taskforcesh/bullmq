# Introduction

BullMQ is based in 5 classes that together can be used to resolve many different problems. These classes are [_**Queue**_](https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/api/bullmq.queue.md), [_**Worker**_](https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/api/bullmq.worker.md), [_**QueueScheduler**_](https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/api/bullmq.queuescheduler.md), [_**QueueEvents**_](https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/api/bullmq.queueevents.md) and [_**FlowProducer**_](https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/api/bullmq.flowproducer.md).

The first class you should know about is the _Queue_ class. This class represents a queue and can be used for adding _**jobs**_ to the queue as well as some other basic manipulation such as pausing, cleaning or getting data from the queue.

Jobs in BullMQ are basically a user created data structure that can be stored in the queue. Jobs are processed by _**workers**_. A _Worker_ is the second class you should be aware about. Workers are instances capable of processing jobs. You can have many workers, either running in the same Node.js process, or in separate processes as well as in different machines. They will all consume jobs from the queue and mark the jobs as completed or failed.
