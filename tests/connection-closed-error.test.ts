import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - internal ioredis constant, only used to guard against drift
import { CONNECTION_CLOSED_ERROR_MSG as IOREDIS_CONNECTION_CLOSED_ERROR_MSG } from 'ioredis/built/utils';
import {
  ConnectionClosedError,
  CONNECTION_CLOSED_ERROR_MSG,
} from '../src/classes/errors/connection-closed-error';
import { isNotConnectionError } from '../src/utils';

describe('ConnectionClosedError', () => {
  it('exposes a local connection closed message matching ioredis', () => {
    // The message is inlined locally so BullMQ can run without ioredis
    // installed (e.g. with the PostgreSQL backend). Guard against drift from
    // the value ioredis actually uses.
    expect(CONNECTION_CLOSED_ERROR_MSG).to.be.equal(
      IOREDIS_CONNECTION_CLOSED_ERROR_MSG,
    );
  });

  it('treats a ConnectionClosedError as a connection error', () => {
    expect(isNotConnectionError(new ConnectionClosedError())).to.be.false;
  });

  it('treats the connection closed message as a connection error', () => {
    const error = new Error(CONNECTION_CLOSED_ERROR_MSG);
    expect(isNotConnectionError(error)).to.be.false;
  });

  it('treats an unrelated error as not a connection error', () => {
    expect(isNotConnectionError(new Error('some other error'))).to.be.true;
  });
});
