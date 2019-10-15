---
description: General description of BullMQ and its features
---

# What is BullMQ

Bull is a Node library that implements a fast and robust queue system based on [redis](https://redis.io/).

Although it is possible to implement queues directly using Redis commands, this library provides an API that takes care of all the low-level details and enriches Redis basic functionality so that more complex use-cases can be handled easily.

If you are new to queues you may wonder why they are needed after all. Queues can solve many different problems in an elegant way, from smoothing out processing peaks to creating robust communication channels between microservices or offloading heavy work from one server to many smaller workers, etc.

### **Features**

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

