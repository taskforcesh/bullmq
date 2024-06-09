/**
 * A processor file to be used in tests.
 *
 */
'use strict';

module.exports = async function (job) {
  return job.getChildrenValues();
};
