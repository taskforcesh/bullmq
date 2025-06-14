import { QueueBase } from '../classes/queue-base';

export type ScriptQueueContext = Pick<
  QueueBase,
  'client' | 'toKey' | 'keys' | 'opts' | 'closing' | 'redisVersion'
>;
