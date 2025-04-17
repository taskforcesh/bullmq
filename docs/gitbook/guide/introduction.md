# Introduction

BullMQ is based in 4 classes that together can be used to resolve many different problems. These classes are [_**Queue**_](https://api.docs.bullmq.io/classes/v5.Queue.html), [_**Worker**_](https://api.docs.bullmq.io/classes/v5.Worker.html), [_**QueueEvents**_](https://api.docs.bullmq.io/classes/v5.QueueEvents.html) and [_**FlowProducer**_](https://api.docs.bullmq.io/classes/v5.FlowProducer.html).

The first class you should know about is the _Queue_ class. This class represents a queue and can be used for adding _**jobs**_ to the queue as well as some other basic manipulation such as pausing, cleaning or getting data from the queue.

Jobs in BullMQ are basically a user created data structure that can be stored in the queue. Jobs are processed by _**workers**_. A _Worker_ is the second class you should be aware about. Workers are instances capable of processing jobs. You can have many workers, either running in the same Node.js process, or in separate processes as well as in different machines. They will all consume jobs from the queue and mark the jobs as completed or failed.
