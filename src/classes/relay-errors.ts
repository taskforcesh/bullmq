/**
 * Error codes shared by the relay's Lua scripts and SQL functions.
 */
export enum RelayErrorCode {
  InvalidTopic = -1,
  InvalidPattern = -2,
  NodeNotRegistered = -3,
  DataTooLarge = -4,
  InvalidId = -5,
}

const MESSAGES: Record<number, string> = {
  [RelayErrorCode.InvalidTopic]: 'Invalid topic',
  [RelayErrorCode.InvalidPattern]: 'Invalid topic pattern',
  [RelayErrorCode.NodeNotRegistered]: 'Relay node is not registered',
  [RelayErrorCode.DataTooLarge]: 'Message data is too large',
  [RelayErrorCode.InvalidId]: 'Invalid relay node or endpoint id',
};

export class RelayError extends Error {
  constructor(
    public readonly code: RelayErrorCode,
    detail?: string,
  ) {
    super(
      `${MESSAGES[code] || `Relay error ${code}`}${detail ? `: ${detail}` : ''}`,
    );
    this.name = 'RelayError';
  }
}

/**
 * Throws a {@link RelayError} if a script result is an error code.
 */
export function checkRelayResult<T>(result: T, detail?: string): T {
  if (typeof result === 'number' && result < 0) {
    throw new RelayError(result, detail);
  }
  return result;
}
