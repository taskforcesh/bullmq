# Timeout jobs

BullMQ does not provide a specific mechanism to timeout jobs, however this can be accomplished in many cases with a custom timeout code in the worker's process function.

The basic concept is to set up a timeout callback that will abort the job processing, and throw an UnrecoverableError (to avoid retries, although this may not alway be the desired behaviour, if so just throw a normal Error).  Note how we specified the timeout as a property of the job's data, in case we want to have different timeouts depending on the job, but we could also have a fixed constant timeout for all jobs if we wanted.

```typescript
const worker = new Worker('foo', async job => {
  let controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), job.data.timeout);
    
  try {
    await doSomethingAbortable(controller.signal);
  } catch(err) {
     if (err.name == "AbortError") {
      throw new UnrecoverableError("Timeout");
    } else {
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }
});
```

In this simple example we assume that doSomethingAbortable is an asynchronous function that can handle abort signals and abort itself gracefully.

Now let's see another case when we want to timeout a fetch call, it would look like this:

```typescript
const worker = new Worker("foo", async (job) => { 
  let controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), job.data.timeout);
  try {
    let response = await fetch("/slowserver.com", {
      signal: controller.signal,
    }); 
    const result = await response.text();
  } catch (err) {
    if (err.name == "AbortError") {
      throw new UnrecoverableError("Timeout");
    } else {
      throw err;
    }
  } finally {
    clearTimeout(timer)
  }
});
```

In this example we are aborting the fetch call using [AbortController](https://developer.mozilla.org/en-US/docs/Web/API/AbortController), which is the default mechanism provided by fetch to abort calls. Note that abort will even cause the async call to response.text() to also throw an Abort exception.

In summary, while it is possible to implement timeout in your jobs, the mechanism to do it may vary depending on the type of asynchronous operations your jobs is performing, but in many cases using AbortController in combination with a setTimeout is more than enough.



