/**
 * A processor file to be used in tests.
 *
 */
import * as delay from './delay';

export default function(/*job*/) {
  return delay(500).then(() => {
    return 42;
  });
};
