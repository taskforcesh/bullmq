/**
 * A processor file to be used in tests.
 *
 */
'use strict';

const delay = require('./delay');

module.exports = function (/*job*/) {
  return delay(500).then(() => {
    const error = new Error('error');
    const value = {};
    value.ref = value;
    error.custom = value;
    error.reference = error;

    throw error;
  });
};
