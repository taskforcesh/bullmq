import { describe, it, expect } from 'vitest';
import {
  parseDuration,
  parseSize,
  RelayError,
  TopicPolicies,
} from '../../src/relay';

describe('relay TopicPolicies', () => {
  it('resolves the most specific matching pattern', () => {
    const policies = new TopicPolicies();
    policies.define('chat.>', { publish: true });
    policies.define('chat.rooms.*.messages', { publish: { echo: 'all' } });
    policies.define('chat.rooms.*.typing', { ephemeral: true, throttle: '1s' });
    policies.define('chat.rooms.42.messages', { retain: '1m' });

    expect(policies.resolve('chat.rooms.42.messages')!.pattern).toBe(
      'chat.rooms.42.messages',
    );
    expect(policies.resolve('chat.rooms.7.messages')!.pattern).toBe(
      'chat.rooms.*.messages',
    );
    expect(policies.resolve('chat.rooms.7.typing')!.throttleMs).toBe(1000);
    expect(policies.resolve('chat.other')!.pattern).toBe('chat.>');
    expect(policies.resolve('nope')).toBeUndefined();
  });

  it('is independent of the definition order', () => {
    const a = new TopicPolicies();
    a.define('*.b', { publish: true });
    a.define('a.*', { retain: 1000 });
    const b = new TopicPolicies();
    b.define('a.*', { retain: 1000 });
    b.define('*.b', { publish: true });
    expect(a.resolve('a.b')!.pattern).toBe('a.*');
    expect(b.resolve('a.b')!.pattern).toBe('a.*');
    expect(a.fingerprint()).toBe(b.fingerprint());
  });

  it('normalizes publish options', () => {
    const policies = new TopicPolicies();
    policies.define('a', { publish: true });
    policies.define('b', {
      publish: { maxSize: '16kb', rateLimit: { max: 5, duration: '1s' } },
    });
    expect(policies.resolve('a')!.publish).toEqual({
      maxSize: undefined,
      rateLimit: undefined,
      onPublish: undefined,
      echo: 'others',
    });
    expect(policies.resolve('b')!.publish).toMatchObject({
      maxSize: 16 * 1024,
      rateLimit: { max: 5, durationMs: 1000 },
      echo: 'others',
    });
    expect(policies.resolve('a')!.retainMs).toBeUndefined();
  });

  it('rejects duplicates, invalid patterns and conflicting kinds', () => {
    const policies = new TopicPolicies();
    policies.define('a.*', {});
    expect(() => policies.define('a.*', {})).toThrow(/already defined/);
    expect(() => policies.define('a.>.b', {})).toThrow(RelayError);
    expect(() =>
      policies.define('x', { retain: '1m', ephemeral: true }),
    ).toThrow(/mutually exclusive/);
    expect(() => policies.define('y', { retain: 'soon' })).toThrow(
      /Invalid retain/,
    );
  });

  it('runs the edition validator', () => {
    const policies = new TopicPolicies({
      validate: (pattern, policy) => {
        if (policy.ordered) {
          throw new RelayError('not_allowed', 'requires BullMQ Pro');
        }
      },
    });
    expect(() => policies.define('chat.>', { ordered: {} })).toThrow(
      /requires BullMQ Pro/,
    );
    expect(policies.size).toBe(0);
  });

  it('changes the fingerprint when policies differ', () => {
    const a = new TopicPolicies();
    a.define('a', { retain: '1m' });
    const b = new TopicPolicies();
    b.define('a', { retain: '2m' });
    const c = new TopicPolicies();
    c.define('a', { retain: '1m', publish: { onPublish: () => undefined } });
    expect(a.fingerprint()).not.toBe(b.fingerprint());
    expect(a.fingerprint()).not.toBe(c.fingerprint());
  });

  it('invalidates its resolution cache on define', () => {
    const policies = new TopicPolicies();
    policies.define('a.>', {});
    expect(policies.resolve('a.b')!.pattern).toBe('a.>');
    policies.define('a.b', {});
    expect(policies.resolve('a.b')!.pattern).toBe('a.b');
  });

  it('caches misses and keeps the resolution cache bounded', () => {
    const policies = new TopicPolicies();
    policies.define('known.*', { retain: '1s' });
    expect(policies.resolve('unknown')).toBeUndefined();
    expect(policies.resolve('unknown')).toBeUndefined();

    for (let i = 0; i < 10_050; i++) {
      expect(policies.resolve(`known.${i}`)!.pattern).toBe('known.*');
    }
    expect((policies as any).cache.size).toBeLessThanOrEqual(10_001);
    expect(policies.resolve('known.0')!.retainMs).toBe(1000);
    expect(policies.resolve('unknown')).toBeUndefined();
  });

  it('includes array values in the fingerprint', () => {
    const a = new TopicPolicies();
    a.define('a', { presence: ['x', 'y'] });
    const b = new TopicPolicies();
    b.define('a', { presence: ['x', 'z'] });
    const c = new TopicPolicies();
    c.define('a', { presence: ['x', 'y'] });
    expect(a.fingerprint()).not.toBe(b.fingerprint());
    expect(a.fingerprint()).toBe(c.fingerprint());
  });
});

describe('relay duration and size parsing', () => {
  it.each([
    [500, 500],
    ['500', 500],
    ['500ms', 500],
    ['10s', 10_000],
    ['10m', 600_000],
    ['1h', 3_600_000],
    ['7d', 604_800_000],
    ['1.5s', 1500],
    [' 2 s ', 2000],
  ])('parses duration %j', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each([['soon'], ['-1'], [-1], [NaN], ['1w']])(
    'rejects duration %j',
    input => {
      expect(() => parseDuration(input as any)).toThrow(RelayError);
    },
  );

  it.each([
    [10, 10],
    ['512b', 512],
    ['16kb', 16384],
    ['1mb', 1048576],
    ['1.5KB', 1536],
  ])('parses size %j', (input, expected) => {
    expect(parseSize(input)).toBe(expected);
  });

  it('rejects invalid sizes', () => {
    expect(() => parseSize('big')).toThrow(RelayError);
    expect(() => parseSize(-5)).toThrow(RelayError);
  });
});
