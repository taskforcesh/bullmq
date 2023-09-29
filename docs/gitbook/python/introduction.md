---
description: BullMQ is now also available as an experimental python package.
---

# Introduction

{% hint style="info" %}
The Python package is still in early development and is not recommended for production deployment just yet. In the following months, we will be hardening the code and adding more testing and we expect to have a production-ready package although not all the features are available as in the NodeJS version.
{% endhint %}

### Installation

BullMQ is delivered as a pip package and can thus be installed using pip:

```
$ pip install bullmq
```

### Get started

BullMQ uses [asyncio](https://docs.python.org/3/library/asyncio.html) in order to implement concurrency and provide efficient processing of jobs.

You can add jobs to a queue like this, assuming you have a Redis host running locally:

```python
from bullmq import Queue

queue = Queue("myQueue")

# Add a job with data { "foo": "bar" } to the queue
await queue.add("myJob", { "foo": "bar" })

...

# Close when done adding jobs
await queue.close()

```

In order to consume the jobs from the queue you need to use the Worker class, providing a "processor" function that will consume the jobs. As soon as the worker is instantiated it will start consuming jobs:

```python
from bullmq import Worker

async def process(job, job_token):
    # job.data will include the data added to the queue
    return doSomethingAsync(job)

async def main():
    # Feel free to remove the connection parameter, if your redis runs on localhost
    worker = Worker("myQueue", process, {"connection": "rediss://<user>:<password>@<host>:<port>"})

    # This while loop is just for the sake of this example
    # you won't need it in practice.
    while True: # Add some breaking conditions here
        await asyncio.sleep(1)

    # When no need to process more jobs we should close the worker
    await worker.close()

if __name__ == "__main__":
    asyncio.run(main())

```

