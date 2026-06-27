/**
 * A simple processor for testing non-BullMQ message handling.
 */
'use strict';

module.exports = function(job) {
  return Promise.resolve({ processed: true, data: job.data });
};
