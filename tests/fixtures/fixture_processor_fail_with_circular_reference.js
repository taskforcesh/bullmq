/**
 * A processor file to be used in tests.
 *
 */
'use strict';

const delay = require('./delay');

module.exports = function (/*job*/) {
  return delay(500).then(() => {
    const error = new Error('error');
    error.reference = error;

    throw error;
  });
};
