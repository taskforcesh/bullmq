/**
 * Error codes used by the relay, both in thrown errors and in `err` frames
 * sent to clients.
 */
export type RelayErrorCode =
  | 'bad_request'
  | 'invalid_topic'
  | 'unauthorized'
  | 'forbidden'
  | 'not_allowed'
  | 'too_large'
  | 'rate_limited'
  | 'no_handler'
  | 'no_recipients'
  | 'insufficient_recipients'
  | 'recipient_lost'
  | 'timeout'
  | 'cancelled'
  | 'busy'
  | 'job_failed'
  | 'remote_error'
  | 'closed'
  | 'internal'
  | string;

/**
 * Base class for all relay errors. `code` is stable and safe to send to
 * clients; `message` is human readable.
 */
export class RelayError extends Error {
  constructor(
    public readonly code: RelayErrorCode,
    message?: string,
  ) {
    super(message || code);
    this.name = 'RelayError';
  }
}

export function toRelayError(err: unknown): RelayError {
  if (err instanceof RelayError) {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  return new RelayError('internal', message);
}
