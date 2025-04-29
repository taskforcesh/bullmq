/**
 * A processor file to be used in tests.
 *
 */
'use strict';

const { UnrecoverableError } = require('../../dist/cjs/classes');
const delay = require('./delay');

module.exports = function (job) {
  return delay(500).then(() => {
    if (job.attemptsMade < 1) {
      throw new Error('Not yet!');
    }
    if (job.attemptsMade < 2) {
      throw new UnrecoverableError();
    }
  });
};
