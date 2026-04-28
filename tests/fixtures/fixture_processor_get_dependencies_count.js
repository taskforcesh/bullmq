/**
 * A processor file to be used in tests.
 *
 */
'use strict';

module.exports = async function (job) {
  const count = await job.getDependenciesCount();
  return count;
};
