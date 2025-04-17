/**
 * A processor file to be used in tests.
 *
 */
'use strict';

// This processor will timeout in 10 seconds.
const MAX_TTL = 1_000;
const CLEANUP_TTL = 500;

const TTL_EXIT_CODE = 10;

module.exports = async function (job) {
  let hasCompleted = false;
  const harKillTimeout = setTimeout(() => {
    if (!hasCompleted) {
      process.exit(TTL_EXIT_CODE);
    }
  }, MAX_TTL);

  const softKillTimeout = setTimeout(async () => {
    await doCleanup(job);
  }, CLEANUP_TTL);

  try {
    // If doAsyncWork is CPU intensive and blocks NodeJS loop forever, the timeout will never be triggered.
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
