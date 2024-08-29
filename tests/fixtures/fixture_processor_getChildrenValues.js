/**
 * A processor file to be used in tests.
 *
 */
'use strict';

module.exports = async function (job) {
  const values  = await job.getChildrenValues();
  return values;
};
