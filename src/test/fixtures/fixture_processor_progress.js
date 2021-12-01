/**
 * A processor file to be used in tests.
 *
 */
'use strict';

const delay = require('./delay');

module.exports = function(job) {
  return delay(50)
    .then(() => {
      job.updateProgress(10);
      return delay(100);
    })
    .then(() => {
      job.updateProgress(27);
      return delay(150);
    })
    .then(() => {
      job.updateProgress(78);
      return delay(100);
    })
    .then(() => {
      job.updateProgress(100);
    })
    .then(() => {
      return 37;
    });
};
