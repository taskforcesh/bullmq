import delay from './delay.js';
export default function (/*job*/) {
  return delay(500).then(() => {
    return 42;
  });
}
