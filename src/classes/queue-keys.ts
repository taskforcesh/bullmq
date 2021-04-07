export type KeysMap = { [index in string]: string };

export class QueueKeys {
  cached: KeysMap;

  constructor(
    public readonly name: string,
    public readonly prefix: string = 'bull',
  ) {
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
      keys[key] = this.toKey(key);
    });

    this.cached = keys as KeysMap;
  }

  toKey(type: string) {
    return `${this.prefixedQueueName}:${type}`;
  }

  get prefixedQueueName() {
    return `${this.prefix}:${this.name}`;
  }
}
