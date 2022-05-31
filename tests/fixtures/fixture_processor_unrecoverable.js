/**
 * A processor file to be used in tests.
 *
 */
'use strict';

const {
  UnrecoverableError,
} = require('../../dist/cjs/classes/unrecoverable-error');
const delay = require('./delay');

module.exports = function (job) {
  return delay(500).then(() => {
    if (job.attemptsMade < 2) {
      throw new Error('Not yet!');
    }
    if (job.attemptsMade < 3) {
      throw new UnrecoverableError('Unrecoverable');
    }
  });
};
