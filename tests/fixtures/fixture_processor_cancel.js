/**
 * A processor file to be used in tests for job cancellation.
 * It performs "work" in a loop and checks the abort signal.
 */
'use strict';

const delay = require('./delay');

module.exports = async function (job, token, signal) {
  for (let i = 0; i < 100; i++) {
    if (signal?.aborted) {
      throw new Error(signal.reason || 'Job was cancelled');
    }
    await delay(100);
  }
  return 42;
};
