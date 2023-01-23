/**
 * A processor file to be used in tests.
 *
 */
'use strict';

const delay = require('./delay');

class TestError extends Error {
  metadata = 'metadata';
}

module.exports = function (/*job*/) {
  return delay(500).then(() => {
    throw new TestError('Manually failed processor');
  });
};
