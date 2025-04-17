'use strict';

const delay = require('./delay');

module.exports = async function (job) {
  let step = job.data.step;
  while (step !== 'FINISH') {
    switch (step) {
      case 'INITIAL': {
        await delay(200);
        const data = {
          ...job.data,
          step: 'SECOND',
          extraDataSecondStep: 'second data',
        };
        await job.updateData(data);
        step = 'SECOND';
        break;
      }
      case 'SECOND': {
        await delay(200);
        const data = {
          ...job.data,
          extraDataFinishedStep: 'finish data',
          step: 'FINISH',
        };

        await job.updateData(data);
        step = 'FINISH';
        return;
      }
      default: {
        throw new Error('invalid step');
      }
    }
  }
};
