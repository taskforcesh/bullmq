/**
 * A processor file to be used in tests.
 *
 */
'use strict';

const delay = require('./delay');

module.exports = function (job) {
  return delay(50)
    .then(() => {
      job.update({ foo: 'bar' });
      return delay(100);
    })
    .then(() => {
      job.update({ foo: 'baz' });
      delay(100);
      return 'result';
    });
};
