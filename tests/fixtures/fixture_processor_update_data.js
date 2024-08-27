/**
 * A processor file to be used in tests.
 *
 */
'use strict';

const delay = require('./delay');

module.exports = function (job) {
  console.log('ya pus');
  return delay(50)
    .then(() => {
      job.updateData({ foo: 'bar' });
      return delay(100);
    })
    .then(() => {
      job.updateData({ foo: 'baz' });
      delay(100);
      return 'result';
    });
};
