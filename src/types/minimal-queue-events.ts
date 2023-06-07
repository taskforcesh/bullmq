import { QueueEvents } from '../classes/queue-events';

export type MinimalQueueEvents = Pick<
  QueueEvents,
  | 'name'
  | 'client'
  | 'close'
  | 'emit'
  | 'toKey'
  | 'keys'
  | 'off'
  | 'on'
  | 'once'
  | 'opts'
  | 'closing'
  | 'waitUntilReady'
  | 'removeListener'
  | 'emit'
  | 'run'
  | 'on'
  | 'redisVersion'
>;
