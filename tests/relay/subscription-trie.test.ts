import { describe, it, expect } from 'vitest';
import { SubscriptionTrie, matchTopic } from '../../src/relay';

describe('relay SubscriptionTrie', () => {
  it('matches exact, * and > patterns', () => {
    const trie = new SubscriptionTrie<string>();
    trie.add('a.b.c', 'exact');
    trie.add('a.*.c', 'star');
    trie.add('a.>', 'tail');
    trie.add('>', 'all');
    trie.add('a.b', 'short');
    trie.add('x.y', 'other');

    expect([...trie.match('a.b.c')].sort()).toEqual([
      'all',
      'exact',
      'star',
      'tail',
    ]);
    expect([...trie.match('a.b')].sort()).toEqual(['all', 'short', 'tail']);
    expect([...trie.match('a')].sort()).toEqual(['all']);
    expect([...trie.match('x.y')].sort()).toEqual(['all', 'other']);
    expect([...trie.match('q')].sort()).toEqual(['all']);
  });

  it('returns each value once even if several patterns match', () => {
    const trie = new SubscriptionTrie<string>();
    trie.add('a.b', 'v');
    trie.add('a.*', 'v');
    trie.add('a.>', 'v');
    expect([...trie.match('a.b')]).toEqual(['v']);
  });

  it('reports first add and last remove per pattern', () => {
    const trie = new SubscriptionTrie<number>();
    expect(trie.add('a.*', 1)).toBe(true);
    expect(trie.add('a.*', 2)).toBe(false);
    expect(trie.add('a.*', 2)).toBe(false); // duplicate value
    expect(trie.count('a.*')).toBe(2);

    expect(trie.remove('a.*', 1)).toBe(false);
    expect(trie.remove('a.*', 1)).toBe(false); // already removed
    expect(trie.remove('a.*', 2)).toBe(true);
    expect(trie.count('a.*')).toBe(0);
    expect(trie.size).toBe(0);
    expect([...trie.match('a.b')]).toEqual([]);
  });

  it('removes values from > patterns and prunes empty branches', () => {
    const trie = new SubscriptionTrie<string>();
    trie.add('a.b.>', 'x');
    trie.add('>', 'y');
    expect(trie.remove('a.b.>', 'x')).toBe(true);
    expect(trie.remove('>', 'y')).toBe(true);
    expect(trie.remove('never.added', 'z')).toBe(false);
    expect(trie.patterns()).toEqual([]);
    expect([...trie.match('a.b.c')]).toEqual([]);
    expect((trie as any).root.isEmpty()).toBe(true);
  });

  it('agrees with matchTopic on randomized input', () => {
    const segments = ['a', 'b', 'c'];
    const pick = () => segments[Math.floor(Math.random() * segments.length)];
    const randomTopic = () =>
      Array.from({ length: 1 + Math.floor(Math.random() * 4) }, pick).join('.');
    const randomPattern = () => {
      const length = 1 + Math.floor(Math.random() * 4);
      const parts = Array.from({ length }, () => {
        const r = Math.random();
        return r < 0.2 ? '*' : pick();
      });
      if (Math.random() < 0.3) {
        parts[parts.length - 1] = '>';
      }
      return parts.join('.');
    };

    const trie = new SubscriptionTrie<string>();
    const patterns = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const pattern = randomPattern();
      patterns.add(pattern);
      trie.add(pattern, pattern);
    }
    for (let i = 0; i < 300; i++) {
      const topic = randomTopic();
      const expected = [...patterns].filter(p => matchTopic(p, topic)).sort();
      expect([...trie.match(topic)].sort()).toEqual(expected);
    }
  });
});
