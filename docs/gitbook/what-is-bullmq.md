---
description: General description of BullMQ and its features
---

# What is BullMQ

BullMQ is a [Node.js](https://nodejs.org) library that implements a fast and robust queue system based on [Redis](https://redis.io/).

The library is designed so that it will fulfil the following goals:

* Exactly once queue semantics, i.e., attempts to deliver every message exactly one time, but it will deliver at least once in the worst case scenario\*.
* Easy to scale horizontally. Add more workers for processing jobs in parallel.
* Consistent.
* High performant. Try to get the highest possible throughput from Redis by combining efficient .lua scripts and pipelining.

View the repository, see open issues, and contribute back [on GitHub](https://github.com/taskforcesh/bullmq)!

## **Features**

If you are new to Message Queues, you may wonder why they are needed after all. Queues can solve many different problems in an elegant way, from smoothing out processing peaks to creating robust communication channels between micro-services or offloading heavy work from one server to many smaller workers, and many other cases. Check the [Patterns](patterns/producer-consumer.md) section for getting some inspiration and information about best practices.

* [x] **Minimal CPU usage due to a polling-free design**
* [x] **Distributed job execution based on Redis**
* [x] **LIFO and FIFO jobs**
* [x] **Priorities**
* [x] **Delayed jobs**
* [x] **Scheduled and repeatable jobs according to cron specifications**
* [x] **Retries of failed jobs**
* [x] **Concurrency setting per worker**
* [x] **Threaded \(sandboxed\) processing functions**
* [x] **Automatic recovery from process crashes**

