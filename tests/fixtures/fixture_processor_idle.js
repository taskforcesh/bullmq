'use strict';

const { randomUUID } = require('node:crypto');
const instanceId = randomUUID();

module.exports = async job => {
  await new Promise(resolve => setTimeout(resolve, job.data.delay));
  return { instanceId, value: job.data.value };
};
