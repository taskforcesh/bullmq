import { RelayError } from './errors';

/**
 * Topic names are dot-separated keypaths, e.g. `queues.emails.jobs.42.progress`.
 *
 * - Segments match `[A-Za-z0-9_\-:%]+`. Any other character must be
 *   percent-encoded (see {@link topicSegment}).
 * - In patterns, `*` matches exactly one segment and `>` matches one or more
 *   trailing segments (only allowed as the last segment).
 * - A first segment starting with `$` denotes a system topic
 *   (`$conn.{id}`, `$principal.{id}`).
 */
export const MAX_TOPIC_DEPTH = 16;
export const MAX_TOPIC_LENGTH = 512;

const SEGMENT_RE = /^[A-Za-z0-9_\-:%]+$/;
const SYSTEM_ROOT_RE = /^\$[A-Za-z]+$/;
const UNENCODED_CHAR_RE = /^[A-Za-z0-9_\-:]$/;
const textEncoder = new TextEncoder();

export const SINGLE_WILDCARD = '*';
export const MULTI_WILDCARD = '>';

function checkShape(value: string, kind: 'topic' | 'pattern'): string[] {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RelayError('invalid_topic', `Invalid ${kind}: empty`);
  }
  if (value.length > MAX_TOPIC_LENGTH) {
    throw new RelayError(
      'invalid_topic',
      `Invalid ${kind}: longer than ${MAX_TOPIC_LENGTH} characters`,
    );
  }
  const segments = value.split('.');
  if (segments.length > MAX_TOPIC_DEPTH) {
    throw new RelayError(
      'invalid_topic',
      `Invalid ${kind}: deeper than ${MAX_TOPIC_DEPTH} segments`,
    );
  }
  return segments;
}

function isValidSegment(segment: string, index: number): boolean {
  if (index === 0 && SYSTEM_ROOT_RE.test(segment)) {
    return true;
  }
  return SEGMENT_RE.test(segment);
}

/**
 * Validates a concrete topic (no wildcards) and returns its segments.
 */
export function validateTopic(topic: string): string[] {
  const segments = checkShape(topic, 'topic');
  segments.forEach((segment, index) => {
    if (!isValidSegment(segment, index)) {
      throw new RelayError(
        'invalid_topic',
        `Invalid topic "${topic}": bad segment "${segment}"`,
      );
    }
  });
  return segments;
}

/**
 * Validates a topic pattern (wildcards allowed) and returns its segments.
 */
export function validatePattern(pattern: string): string[] {
  const segments = checkShape(pattern, 'pattern');
  segments.forEach((segment, index) => {
    if (segment === SINGLE_WILDCARD) {
      return;
    }
    if (segment === MULTI_WILDCARD) {
      if (index !== segments.length - 1) {
        throw new RelayError(
          'invalid_topic',
          `Invalid pattern "${pattern}": ">" is only allowed as the last segment`,
        );
      }
      return;
    }
    if (!isValidSegment(segment, index)) {
      throw new RelayError(
        'invalid_topic',
        `Invalid pattern "${pattern}": bad segment "${segment}"`,
      );
    }
  });
  return segments;
}

export function isPattern(value: string): boolean {
  return value
    .split('.')
    .some(segment => segment === SINGLE_WILDCARD || segment === MULTI_WILDCARD);
}

export function isSystemTopic(value: string): boolean {
  return value.startsWith('$');
}

/**
 * Returns true if the concrete `topic` matches `pattern`.
 */
export function matchTopic(pattern: string, topic: string): boolean {
  const p = pattern.split('.');
  const t = topic.split('.');
  for (let i = 0; i < p.length; i++) {
    const segment = p[i];
    if (segment === MULTI_WILDCARD) {
      return t.length > i;
    }
    if (i >= t.length) {
      return false;
    }
    if (segment !== SINGLE_WILDCARD && segment !== t[i]) {
      return false;
    }
  }
  return p.length === t.length;
}

function segmentRank(segment: string | undefined): number {
  if (segment === undefined) {
    return 3;
  }
  if (segment === MULTI_WILDCARD) {
    return 2;
  }
  if (segment === SINGLE_WILDCARD) {
    return 1;
  }
  return 0;
}

/**
 * Orders patterns from most to least specific: segment by segment, a
 * literal beats `*`, `*` beats `>`, and a longer pattern beats a shorter one.
 * Two different patterns that can match the same topic never compare equal.
 *
 * @returns a negative number if `a` is more specific than `b`.
 */
export function compareSpecificity(a: string, b: string): number {
  const sa = a.split('.');
  const sb = b.split('.');
  const length = Math.max(sa.length, sb.length);
  for (let i = 0; i < length; i++) {
    const diff = segmentRank(sa[i]) - segmentRank(sb[i]);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * Encodes an arbitrary value (queue name, job id, user id…) as a single
 * topic segment. Characters outside `[A-Za-z0-9_\-:]` are percent-encoded
 * (UTF-8), so the result never contains `.`, `*`, `>` or `$`.
 */
export function topicSegment(value: string | number): string {
  const str = String(value);
  if (str.length === 0) {
    throw new RelayError('invalid_topic', 'Topic segments cannot be empty');
  }
  let out = '';
  for (const char of str) {
    if (UNENCODED_CHAR_RE.test(char)) {
      out += char;
    } else {
      out += Array.from(textEncoder.encode(char))
        .map(byte => '%' + byte.toString(16).toUpperCase().padStart(2, '0'))
        .join('');
    }
  }
  return out;
}

/**
 * Reverses {@link topicSegment}.
 */
export function decodeTopicSegment(segment: string): string {
  return decodeURIComponent(segment);
}

/**
 * Builds a topic from raw values, encoding each one as a segment.
 *
 * @example buildTopic('queues', 'my.queue', 'jobs', 42) === 'queues.my%2Equeue.jobs.42'
 */
export function buildTopic(...values: (string | number)[]): string {
  return values.map(topicSegment).join('.');
}

/**
 * Translates a pattern into a Redis glob for `PSUBSCRIBE`. The glob may be
 * broader than the pattern (Redis `*` also matches dots), so callers must
 * still filter with {@link matchTopic}.
 */
export function toRedisGlob(pattern: string): string {
  return pattern
    .split('.')
    .map(segment =>
      segment === SINGLE_WILDCARD || segment === MULTI_WILDCARD ? '*' : segment,
    )
    .join('.');
}

/**
 * True if every topic matched by `inner` is also matched by `outer`.
 */
export function patternCovers(outer: string, inner: string): boolean {
  const o = outer.split('.');
  const i = inner.split('.');
  for (let k = 0; k < o.length; k++) {
    if (o[k] === MULTI_WILDCARD) {
      return i.length > k;
    }
    if (k >= i.length || i[k] === MULTI_WILDCARD) {
      return false;
    }
    if (o[k] === SINGLE_WILDCARD) {
      continue;
    }
    if (o[k] !== i[k]) {
      return false;
    }
  }
  return o.length === i.length;
}

/**
 * True if at least one topic is matched by both patterns.
 */
export function patternsOverlap(a: string, b: string): boolean {
  const x = a.split('.');
  const y = b.split('.');
  for (let k = 0; ; k++) {
    const s = x[k];
    const t = y[k];
    if (s === MULTI_WILDCARD) {
      return t !== undefined;
    }
    if (t === MULTI_WILDCARD) {
      return s !== undefined;
    }
    if (s === undefined || t === undefined) {
      return s === t;
    }
    if (s !== SINGLE_WILDCARD && t !== SINGLE_WILDCARD && s !== t) {
      return false;
    }
  }
}
