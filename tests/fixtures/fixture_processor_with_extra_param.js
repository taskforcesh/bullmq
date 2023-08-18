/**
 * A processor file to be used in tests.
 *
 */
'use strict';

const delay = require('./delay');

module.exports = function (job, extraParam) {
  return delay(500).then(() => {
    return 42;
  });
};
