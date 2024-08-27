/**
 * A processor file to be used in tests.
 *
 */
'use strict';

module.exports = function (job) {
  console.log('otro jeronimo');
  return { childResult: 'bar' };
};
