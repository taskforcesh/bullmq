/**
 * A processor that fails to import (initialize) only the first time, simulating
 * a transient failure during module load (e.g. ENOMEM, EACCES, a momentarily
 * missing file). A flag file controls whether this import should throw.
 *
 * On the first import the flag file exists: we delete it and throw, so the
 * child fails to initialize. Every subsequent import (in a freshly forked
 * child) finds no flag file and exports a working processor.
 */
'use strict';

const { existsSync, unlinkSync } = require('fs');
const path = require('path');

const flag = path.join(__dirname, 'fail-init-once.flag');

if (existsSync(flag)) {
  unlinkSync(flag);
  throw new Error('transient module load failure');
}

module.exports = function (job) {
  return Promise.resolve('ok');
};
