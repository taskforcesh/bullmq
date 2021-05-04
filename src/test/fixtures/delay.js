'use strict';

module.exports = function delay(ms) {
  return new Promise(function(resolve) {
    return setTimeout(resolve, ms);
  });
};
