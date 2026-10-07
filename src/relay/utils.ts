import { RelayError } from './errors';

const DURATION_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i;
const SIZE_RE = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i;

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const SIZE_UNITS: Record<string, number> = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
};

/**
 * A duration in milliseconds, or a string such as `'500ms'`, `'10s'`,
 * `'10m'`, `'1h'` or `'7d'`.
 */
export type Duration = number | string;

/**
 * A size in bytes, or a string such as `'512b'`, `'16kb'` or `'1mb'`.
 */
export type Size = number | string;

export function parseDuration(value: Duration, name = 'duration'): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new RelayError('bad_request', `Invalid ${name}: ${value}`);
    }
    return value;
  }
  const match = DURATION_RE.exec(String(value).trim());
  if (!match) {
    throw new RelayError('bad_request', `Invalid ${name}: ${value}`);
  }
  const unit = (match[2] || 'ms').toLowerCase();
  return Math.round(parseFloat(match[1]) * DURATION_UNITS[unit]);
}

export function parseSize(value: Size, name = 'size'): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      throw new RelayError('bad_request', `Invalid ${name}: ${value}`);
    }
    return value;
  }
  const match = SIZE_RE.exec(String(value).trim());
  if (!match) {
    throw new RelayError('bad_request', `Invalid ${name}: ${value}`);
  }
  const unit = (match[2] || 'b').toLowerCase();
  return Math.round(parseFloat(match[1]) * SIZE_UNITS[unit]);
}
