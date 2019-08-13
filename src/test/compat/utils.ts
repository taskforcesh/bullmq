import { Queue3 as Queue, QueueOptions3 as QueueOptions } from '@src/classes/compat';
import _ from 'lodash';

const STD_QUEUE_NAME = 'test queue';

let queues: Queue[] = [];

const originalSetTimeout = setTimeout;

export function simulateDisconnect(queue: Queue) {
  queue.client.disconnect();
  queue.eclient.disconnect();
}

export function buildQueue(name?: string, options?: QueueOptions) {
  options = _.extend({ redis: { port: 6379, host: '127.0.0.1' } }, options);
  const queue = new Queue(name || STD_QUEUE_NAME, options);
  queues.push(queue);
  return queue;
}

export function newQueue(name?: string, opts?: QueueOptions) {
  const queue = buildQueue(name, opts);
  return queue.isReady();
}

export function cleanupQueue(queue: Queue) {
  return queue.empty().then(queue.close.bind(queue));
}

export function cleanupQueues() {
  return Promise.all(
    queues.map(queue => {
      const errHandler = function() {};
      queue.on('error', errHandler);
      return queue.close().catch(errHandler);
    })
  ).then(() => {
    queues = [];
  });
}

export function sleep(ms: number, retval?: any) {
  return new Promise(resolve => {
    originalSetTimeout(() => {
      if(retval && retval.value) {
        resolve(retval.value);
      } else {
        resolve();
      }
    }, ms);
  });
}
