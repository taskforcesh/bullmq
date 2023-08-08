/**
 * A processor file to be used in tests.
 *
 */
'use strict';

const { DelayedError } = require('../../dist/cjs/classes/delayed-error');
const delay = require('./delay');

module.exports = function (job, token) {
  return delay(500)
    .then(() => {
      job.moveToDelayed(5000, token);
      return delay(200);
    })
    .then(() => {
      throw new DelayedError();
    });
};
