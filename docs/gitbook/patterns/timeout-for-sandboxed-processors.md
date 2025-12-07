---
description: A pattern for applying time-to-live to sandboxed processors.
---

# Timeout for Sandboxed processors

When you are working with sandboxed processors, every job is run in a separate process. This opens the possibility to implement a time-to-live (TTL) mechanism, that kills the process if it has not been able to complete in a reasonable time.

It is important to understand that killing a process can have unintented consecuences, for instance it could be killed in the middle of a writing transaction to a file, that would most likely result in a corrupt file. However, this is kind of the best that is possible to achieve in a runtime as NodeJS which based on asynchronous calls within an event loop. There is currently no known method to achieve this functionality in a more robust way.

This pattern tries to be as possible, but please, keep in mind the trade-offs mentioned above. The pattern uses two timeouts so that it is possible to have a cleanup operation to minimize the effects of a hard kill of the process. Obviously if the cleanup itself hangs, or if the cleanup is not correctly implemented, we can still end killing some database connections or writing operantions right in the middle, with the potential negative outcomes.&#x20;

```typescript
// This processor will timeout in 30 seconds.
const MAX_TTL = 30_000;

// The processor will have a cleanup timeout of 5 seconds.
const CLEANUP_TTL = 5_000;

// We use a custom exit code to mark the TTL, but any would do in practice
// as long as it is < 256 (Due to Unix limitation to 8 bits per exit code)
const TTL_EXIT_CODE = 10;

module.exports = async function (job) {
  let hasCompleted = false;
  const harKillTimeout = setTimeout(() => {
    if (!hasCompleted) {
      process.exit(TTL_EXIT_CODE);
    }
  }, MAX_TTL);

  const softKillTimeout = setTimeout(async () => {
    if (!hasCompleted) {
      await doCleanup(job);
    }
  }, CLEANUP_TTL);

  try {
    // If doAsyncWork is CPU intensive and blocks NodeJS loop forever,
    // the timeout will never be triggered either.
    await doAsyncWork(job);
    hasCompleted = true;
  } finally {
    // Important to clear the timeouts before returning as this process will be reused.
    clearTimeout(harKillTimeout);
    clearTimeout(softKillTimeout);
  }
};

const doAsyncWork = async job => {
  // Simulate a long running operation.
  await new Promise(resolve => setTimeout(resolve, 10000));
};

const doCleanup = async job => {
  // Simulate a cleanup operation.
  await job.updateProgress(50);
};

```

There are some very important points to consider with this pattern.

* If the processor has hanged because there is an infinite loop that does not let the NodeJS event loop to run, the TTL timeouts will never be called.
* We keep a `hasCompleted` flag so that we can cover the edge case where the async work has just completed at the same time the timeout is triggered.
* When using this pattern it is very useful to put debug logs in strategic places to see where the job actually gets stuck when it is killed due to the TTL being exceeded.
