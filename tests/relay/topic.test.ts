import { describe, it, expect } from 'vitest';
import {
  buildTopic,
  compareSpecificity,
  decodeTopicSegment,
  isPattern,
  isSystemTopic,
  matchTopic,
  MAX_TOPIC_DEPTH,
  MAX_TOPIC_LENGTH,
  patternCovers,
  patternsOverlap,
  RelayError,
  toRedisGlob,
  topicParams,
  topicSegment,
  toRelayError,
  validatePattern,
  validateTopic,
} from '../../src/relay';

describe('relay topics', () => {
  describe('validateTopic', () => {
    it('accepts dot-separated keypaths', () => {
      expect(validateTopic('queues.emails.jobs.42.progress')).toEqual([
        'queues',
        'emails',
        'jobs',
        '42',
        'progress',
      ]);
      expect(validateTopic('a')).toEqual(['a']);
      expect(validateTopic('a-b_c:d.%2E')).toEqual(['a-b_c:d', '%2E']);
    });

    it('accepts system topics only with a $ root', () => {
      expect(validateTopic('$principal.user-1')).toHaveLength(2);
      expect(validateTopic('$conn.abc')).toHaveLength(2);
      expect(() => validateTopic('a.$conn')).toThrow(RelayError);
      expect(() => validateTopic('$.a')).toThrow(RelayError);
      expect(() => validateTopic('$1.a')).toThrow(RelayError);
    });

    it.each([
      [''],
      ['.'],
      ['a.'],
      ['.a'],
      ['a..b'],
      ['a b'],
      ['a.b/c'],
      ['a.*'],
      ['a.>'],
      ['a.b*'],
      ['ä'],
    ])('rejects %j', topic => {
      expect(() => validateTopic(topic)).toThrow(RelayError);
      try {
        validateTopic(topic);
      } catch (err) {
        expect((err as RelayError).code).toBe('invalid_topic');
      }
    });

    it('rejects non-string values', () => {
      expect(() => validateTopic(undefined as any)).toThrow(RelayError);
      expect(() => validateTopic(42 as any)).toThrow(RelayError);
    });

    it('enforces the max depth and length', () => {
      const deep = Array.from({ length: MAX_TOPIC_DEPTH }, () => 'a').join('.');
      expect(validateTopic(deep)).toHaveLength(MAX_TOPIC_DEPTH);
      expect(() => validateTopic(deep + '.a')).toThrow(/deeper/);

      const long = 'a'.repeat(MAX_TOPIC_LENGTH);
      expect(validateTopic(long)).toHaveLength(1);
      expect(() => validateTopic(long + 'a')).toThrow(/longer/);
    });
  });

  describe('validatePattern', () => {
    it('accepts wildcards', () => {
      expect(validatePattern('a.*.c')).toHaveLength(3);
      expect(validatePattern('a.>')).toHaveLength(2);
      expect(validatePattern('*')).toHaveLength(1);
      expect(validatePattern('>')).toHaveLength(1);
      expect(validatePattern('*.*.>')).toHaveLength(3);
      expect(validatePattern('$principal.*')).toHaveLength(2);
    });

    it('rejects > anywhere but the end', () => {
      expect(() => validatePattern('a.>.c')).toThrow(/last segment/);
      expect(() => validatePattern('>.a')).toThrow(/last segment/);
    });

    it('rejects partial wildcards and empty segments', () => {
      expect(() => validatePattern('a.b*')).toThrow(RelayError);
      expect(() => validatePattern('a.>>')).toThrow(RelayError);
      expect(() => validatePattern('a..*')).toThrow(RelayError);
    });
  });

  describe('matchTopic', () => {
    it.each([
      ['a.b.c', 'a.b.c', true],
      ['a.b.c', 'a.b', false],
      ['a.b', 'a.b.c', false],
      ['a.*.c', 'a.b.c', true],
      ['a.*.c', 'a.b.d', false],
      ['a.*.c', 'a.b.x.c', false],
      ['a.*', 'a', false],
      ['a.>', 'a', false],
      ['a.>', 'a.b', true],
      ['a.>', 'a.b.c.d', true],
      ['>', 'a', true],
      ['>', 'a.b', true],
      ['*', 'a', true],
      ['*', 'a.b', false],
      ['*.*.>', 'a.b', false],
      ['*.*.>', 'a.b.c', true],
      ['queues.*.jobs.*.progress', 'queues.q.jobs.1.progress', true],
      ['queues.*.jobs.*.progress', 'queues.q.jobs.1.completed', false],
    ])('%s matches %s → %s', (pattern, topic, expected) => {
      expect(matchTopic(pattern, topic)).toBe(expected);
    });

    it('treats segments literally (no partial matches)', () => {
      expect(matchTopic('a.b', 'a.bb')).toBe(false);
      expect(matchTopic('a.bb', 'a.b')).toBe(false);
    });
  });

  describe('compareSpecificity', () => {
    it('orders literal > * > > and longer > shorter', () => {
      const patterns = ['>', 'a.>', 'a.*', 'a.b', '*.b', 'a.b.>', '*.>'];
      const sorted = [...patterns].sort(compareSpecificity);
      expect(sorted).toEqual(['a.b.>', 'a.b', 'a.*', 'a.>', '*.b', '*.>', '>']);
    });

    it('never ties two overlapping patterns', () => {
      const overlapping = [
        ['a.*', '*.b'],
        ['a.>', 'a.*'],
        ['*.*', '*.>'],
        ['a.b.>', 'a.>'],
      ];
      for (const [x, y] of overlapping) {
        expect(compareSpecificity(x, y)).not.toBe(0);
        expect(Math.sign(compareSpecificity(x, y))).toBe(
          -Math.sign(compareSpecificity(y, x)),
        );
      }
    });
  });

  describe('segments', () => {
    it('encodes unsafe characters and round-trips', () => {
      const values = [
        'my.queue',
        'a b',
        '50%',
        'ä€😀',
        'x*y>z',
        '$root',
        'ok-1:2_3',
      ];
      for (const value of values) {
        const segment = topicSegment(value);
        expect(() => validateTopic(segment)).not.toThrow();
        expect(segment).not.toMatch(/[.*>$ ]/);
        expect(decodeTopicSegment(segment)).toBe(value);
      }
      expect(topicSegment('ok-1:2_3')).toBe('ok-1:2_3');
      expect(topicSegment('my.queue')).toBe('my%2Equeue');
      expect(topicSegment(42)).toBe('42');
    });

    it('rejects empty segments', () => {
      expect(() => topicSegment('')).toThrow(RelayError);
    });

    it('builds topics from raw values', () => {
      expect(buildTopic('queues', 'my.queue', 'jobs', 42)).toBe(
        'queues.my%2Equeue.jobs.42',
      );
    });
  });

  describe('helpers', () => {
    it('detects patterns and system topics', () => {
      expect(isPattern('a.*')).toBe(true);
      expect(isPattern('a.>')).toBe(true);
      expect(isPattern('a.b')).toBe(false);
      expect(isSystemTopic('$conn.x')).toBe(true);
      expect(isSystemTopic('conn.x')).toBe(false);
    });

    it('translates patterns to (broader) Redis globs', () => {
      expect(toRedisGlob('a.*.c')).toBe('a.*.c');
      expect(toRedisGlob('a.b.>')).toBe('a.b.*');
      expect(toRedisGlob('a.b')).toBe('a.b');
    });

    it('extracts wildcard params', () => {
      expect(
        topicParams('chat.rooms.*.messages', 'chat.rooms.42.messages'),
      ).toEqual(['42']);
      expect(topicParams('a.*.b.>', 'a.x.b.c.d')).toEqual(['x', 'c.d']);
      expect(topicParams('a.b', 'a.b')).toEqual([]);
    });
  });

  describe('patternCovers', () => {
    it.each([
      ['a.>', 'a.b', true],
      ['a.>', 'a.b.>', true],
      ['a.>', 'a.*', true],
      ['a.>', 'a', false],
      ['>', 'a.*.c', true],
      ['a.*', 'a.b', true],
      ['a.*', 'a.*', true],
      ['a.*', 'a.>', false],
      ['a.*', 'a.b.c', false],
      ['a.b', 'a.*', false],
      ['a.b', 'a.b', true],
      ['a.b', 'a.c', false],
      ['chat.rooms.42.>', 'chat.rooms.42.messages', true],
      ['chat.rooms.42.>', 'chat.rooms.*.messages', false],
      ['chat.rooms.42.>', 'chat.>', false],
    ])('%s covers %s → %s', (outer, inner, expected) => {
      expect(patternCovers(outer, inner)).toBe(expected);
    });

    it('agrees with matchTopic: every topic of the inner pattern matches the outer', () => {
      const topics = ['a', 'a.b', 'a.c', 'a.b.c', 'a.b.d', 'x.b.c'];
      const patterns = [
        'a',
        'a.b',
        'a.*',
        'a.>',
        'a.b.>',
        '*.b.c',
        '>',
        'a.*.c',
      ];
      for (const outer of patterns) {
        for (const inner of patterns) {
          if (patternCovers(outer, inner)) {
            for (const topic of topics.filter(t => matchTopic(inner, t))) {
              expect(matchTopic(outer, topic)).toBe(true);
            }
          }
        }
      }
    });
  });

  describe('patternsOverlap', () => {
    it.each([
      ['a.*', '*.b', true],
      ['a.>', 'a.b.c', true],
      ['a.>', 'a', false],
      ['a.b', 'a.c', false],
      ['a.*', 'a.b.c', false],
      ['*.*', '*.>', true],
      ['>', 'x', true],
      ['a.b', 'a.b', true],
      ['a.b.>', 'a.c.>', false],
    ])('%s overlaps %s → %s', (a, b, expected) => {
      expect(patternsOverlap(a, b)).toBe(expected);
      expect(patternsOverlap(b, a)).toBe(expected);
    });

    it('agrees with matchTopic on a sample of topics', () => {
      const topics = ['a', 'b', 'a.b', 'a.c', 'b.b', 'a.b.c', 'a.c.c', 'b.b.b'];
      const patterns = [
        'a',
        'a.b',
        'a.*',
        'a.>',
        '*.b',
        '*.*',
        '*.>',
        '>',
        'a.*.c',
        'b.>',
      ];
      for (const x of patterns) {
        for (const y of patterns) {
          const shared = topics.some(t => matchTopic(x, t) && matchTopic(y, t));
          if (shared) {
            expect(patternsOverlap(x, y)).toBe(true);
          }
        }
      }
    });
  });

  describe('toRelayError', () => {
    it('keeps relay errors and wraps anything else as internal', () => {
      const relayError = new RelayError('forbidden', 'nope');
      expect(toRelayError(relayError)).toBe(relayError);

      const wrapped = toRelayError(new Error('boom'));
      expect(wrapped).toBeInstanceOf(RelayError);
      expect(wrapped.code).toBe('internal');
      expect(wrapped.message).toBe('boom');

      expect(toRelayError('text').message).toBe('text');
      expect(new RelayError('timeout').message).toBe('timeout');
    });
  });
});
