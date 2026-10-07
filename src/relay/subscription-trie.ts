import { MULTI_WILDCARD, SINGLE_WILDCARD } from './topic';

class TrieNode<T> {
  children = new Map<string, TrieNode<T>>();
  star?: TrieNode<T>;
  /** Values whose pattern ends exactly at this node. */
  values = new Set<T>();
  /** Values whose pattern is this node's prefix followed by `>`. */
  tailValues = new Set<T>();

  isEmpty(): boolean {
    return (
      this.children.size === 0 &&
      !this.star &&
      this.values.size === 0 &&
      this.tailValues.size === 0
    );
  }
}

/**
 * Maps topic patterns to values (e.g. subscriptions) and finds, for a
 * concrete topic, every value whose pattern matches it.
 */
export class SubscriptionTrie<T> {
  private root = new TrieNode<T>();
  private counts = new Map<string, number>();

  /**
   * Adds `value` under `pattern`. Returns true if this is the first value for
   * that pattern.
   */
  add(pattern: string, value: T): boolean {
    let node = this.root;
    const segments = pattern.split('.');
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (segment === MULTI_WILDCARD) {
        if (node.tailValues.has(value)) {
          return false;
        }
        node.tailValues.add(value);
        return this.increment(pattern);
      }
      if (segment === SINGLE_WILDCARD) {
        node.star = node.star || new TrieNode<T>();
        node = node.star;
      } else {
        let child = node.children.get(segment);
        if (!child) {
          child = new TrieNode<T>();
          node.children.set(segment, child);
        }
        node = child;
      }
    }
    if (node.values.has(value)) {
      return false;
    }
    node.values.add(value);
    return this.increment(pattern);
  }

  /**
   * Removes `value` from `pattern`. Returns true if it was the last value for
   * that pattern.
   */
  remove(pattern: string, value: T): boolean {
    const removed = this.removeAt(this.root, pattern.split('.'), 0, value);
    if (!removed) {
      return false;
    }
    const count = (this.counts.get(pattern) || 1) - 1;
    if (count <= 0) {
      this.counts.delete(pattern);
      return true;
    }
    this.counts.set(pattern, count);
    return false;
  }

  /**
   * Returns every value whose pattern matches the concrete `topic`.
   */
  match(topic: string): Set<T> {
    const result = new Set<T>();
    this.collect(this.root, topic.split('.'), 0, result);
    return result;
  }

  /**
   * Number of values registered under `pattern`.
   */
  count(pattern: string): number {
    return this.counts.get(pattern) || 0;
  }

  patterns(): string[] {
    return Array.from(this.counts.keys());
  }

  get size(): number {
    return this.counts.size;
  }

  private increment(pattern: string): boolean {
    const count = (this.counts.get(pattern) || 0) + 1;
    this.counts.set(pattern, count);
    return count === 1;
  }

  private collect(
    node: TrieNode<T>,
    segments: string[],
    index: number,
    result: Set<T>,
  ): void {
    if (index === segments.length) {
      node.values.forEach(value => result.add(value));
      return;
    }
    node.tailValues.forEach(value => result.add(value));
    const child = node.children.get(segments[index]);
    if (child) {
      this.collect(child, segments, index + 1, result);
    }
    if (node.star) {
      this.collect(node.star, segments, index + 1, result);
    }
  }

  private removeAt(
    node: TrieNode<T>,
    segments: string[],
    index: number,
    value: T,
  ): boolean {
    const segment = segments[index];
    if (segment === MULTI_WILDCARD) {
      return node.tailValues.delete(value);
    }
    if (index === segments.length) {
      return node.values.delete(value);
    }
    const child =
      segment === SINGLE_WILDCARD ? node.star : node.children.get(segment);
    if (!child) {
      return false;
    }
    const removed = this.removeAt(child, segments, index + 1, value);
    if (removed && child.isEmpty()) {
      if (segment === SINGLE_WILDCARD) {
        node.star = undefined;
      } else {
        node.children.delete(segment);
      }
    }
    return removed;
  }
}
