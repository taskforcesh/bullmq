export interface IoredisListener {
  /**
   * Listen to 'ioredis:close' event.
   *
   * This event is triggered when ioredis is closed.
   */
  'ioredis:close': () => void;
}
