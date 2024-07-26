# Parallelism and Concurrency

In this chapter we would like to clean up some misconceptions regarding parallel execution and concurrency, how these two terms are applied to BullMQ queues, and how they can be used to maximize throughput depending on the kind of jobs that you need to process.

## Parallelism

Parallelism is the simplest of these two concepts as it means basically what your intuition will tell you: that two or more tasks can be run in parallel, independently of each other. This is the case when you have a multi-core processor, or if you have several machines running at the same time. There is a chance that tasks are running in parallel. However, running in parallel does not guarantee that the CPU time is maximized, mainly because most software is continually being blocked by slow IO operations such as reading from the network, writing to disk, sending and receiving data via peripherals, and so on.

If tasks are very CPU intensive though, then being able to run them 100% in parallel will give you the biggest performance, as there will be very little overhead, but this is the exception rather than the norm, thats why in modern computers most tasks are instead run concurrently.

## Concurrency

In the context of computer science, concurrency refers to the ability of different tasks to run at the same time by dividing the available CPU into small slices so that all the tasks can advance in their processing, giving the impression that they are being executed independently in parallel. So when we say that we have 100 tasks running concurrently, it means that they are all advancing their processing but never at exactly the same time.

#### NodeJS Event Loop

One of the features that makes NodeJS very efficient at dispatching requests in an HTTP server is the fact that it has one single loop and is capable of running a huge amount of microtasks concurrently by exploiting the async nature of IO calls. So for example, if a call is performed to a database for querying some data, that call will not block the entire NodeJS, instead it will go and execute some other piece of code and then at the end of the current event loop, check if any of the async calls have completed so that they can continue running in the next iteration.

This gives the effect of parallel execution, however, it is not the case, and the only reason it is efficient is that the code is IO heavy thus we can better utilize the CPU time by executing code instead of just being idle waiting for and asynchronous call to finish.

#### BullMQ concurrency

BullMQ allows you to set a concurrency setting on your workers. This setting is local for the worker and exploits the NodeJS event loop so that jobs that are IO-heavy will benefit from higher throughput, as the worker does not need to wait for a job to complete before it can pick the next one. But it is very important to understand that if the jobs are not IO-heavy but instead are CPU intensive, increasing concurrency will decrease the overall throughput as we will just be adding overhead when there is not a lot that can be done to run concurrently.

#### What about threading?

Threads are a mechanism used by the operating system to provide concurrent (and parallel) execution,  by pre-empting a given thread by another one (in the case of threads running in the same CPU), or by running threads in parallel if there are several CPU cores available. In practice however, a modern OS runs hundreds if not thousands of threads at any given time, so actually no guarantee running code in several threads will indeed run in parallel, there is just a chance they will, and this depends a lot on how the given OS has implemented its scheduler, this can be quite complex but as a rule of thumb we can say that if there are 2 threads that consume a lot of CPU, and there are at least 2 cores, then most likely these two threads will run each on its dedicated CPU.

NodeJS has thread support, but it is important to note that these threads are pretty heavy and almost consume the same amount of memory as if they were running in two different OS processes. The reason for this is that every NodeJS thread requires a complete V8 VM, with a lot of built-in libraries, which will add up to several dozens of megabytes.

## How to best use BullMQ's concurrency then?

You have 2 ways to increase parallelism and concurrency with BullMQ: you can specify the concurrency factor per worker, and you can have several workers running in parallel.

The concurrency factor will just take advantage of NodeJS's event loop so that the worker can process several jobs concurrently while the jobs are doing IO operations. If your jobs require IO operations, then you can increase this number quite a lot. Something between 100 and 300 is a quite standard setting, the only way to finetune this value is by observing how the worker processes the production workload.

If the jobs are very CPU intensive without IO calls, then there is no point in having a large concurrency number as it will just add overhead. Still, since BullMQ itself also performs IO operations (when updating Redis and fetching new jobs), there is a chance that a slight concurrency factor may even improve the throughput of CPU-intensive jobs.

Secondly, you can run as many workers as you want. Every worker will run in parallel if it has a CPU at its disposal. You can run several workers in a given machine if the machine has more than one core, but you can also run workers in totally different machines. The jobs running on different workers will be running in parallel, so even if the job is CPU-intensive you will be able to increase the throughput which will normally scale linearly with the number of workers.
