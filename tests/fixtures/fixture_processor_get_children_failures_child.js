/**
 * A processor file to be used in tests.
 *
 */
'use strict';

module.exports = function (job) {
  throw new Error('child error');
};
