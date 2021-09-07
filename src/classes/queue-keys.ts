export type KeysMap = { [index in string]: string };

export class QueueKeys {
  constructor(public readonly prefix: string = 'bull') {}

  getKeys(name: string): KeysMap {
    const keys: { [index: string]: string } = {};
    [
      '',
      'active',
      'wait',
      'waiting',
      'paused',
      'resumed',
      'id',
      'delayed',
      'priority',
      'stalled-check',
      'completed',
      'failed',
      'stalled',
      'repeat',
      'limiter',
      'drained',
      'progress',
      'meta',
      'events',
      'delay',
    ].forEach(key => {
      keys[key] = this.toKey(name, key);
    });

    return keys;
  }

  toKey(name: string, type: string): string {
    return `${this.getPrefixedQueueName(name)}:${type}`;
  }

  getPrefixedQueueName(name: string): string {
    return `${this.prefix}:${name}`;
  }
}
