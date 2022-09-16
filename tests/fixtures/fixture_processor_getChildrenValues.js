/**
 * A processor file to be used in tests.
 *
 */
'use strict';

const delay = require('./delay');

module.exports = async function (job) {
  return job.getChildrenValues();
};
