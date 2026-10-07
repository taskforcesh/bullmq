import { createHash } from 'crypto';
import { RelayError } from './errors';
import { compareSpecificity, matchTopic, validatePattern } from './topic';
import { Duration, parseDuration, parseSize, Size } from './utils';

export type EchoMode = 'others' | 'all' | 'none';

export interface ClientPublishPolicy<P = any> {
  /**
   * Max size of the published payload (serialized). Default: the relay's
   * `maxMessageSize`.
   */
  maxSize?: Size;
  /**
   * Token bucket per connection and topic: at most `max` publishes every
   * `duration`.
   */
  rateLimit?: { max: number; duration: Duration };
  /**
   * Validate, transform or enrich a client message before it is fanned out.
   * Throw a `RelayError` to reject it. The return value replaces the
   * message data (return `undefined` to keep it unchanged).
   */
  onPublish?: (
    message: { topic: string; data: unknown },
    ctx: PublishContext<P>,
  ) => unknown | Promise<unknown>;
  /**
   * Who receives a copy of the message among the sender's own connections.
   * - `'others'` (default): every subscriber except the publishing connection.
   * - `'all'`: including the publishing connection.
   * - `'none'`: no connection of the publishing principal.
   */
  echo?: EchoMode;
}

export interface PublishContext<P = any> {
  principalId: string;
  principal: P;
  connectionId: string;
  params: string[];
}

/**
 * Server-side declaration of a topic's behaviour, per pattern.
 */
export interface TopicPolicy<P = any> {
  /**
   * Retained topic: keep the last message for this long and deliver it right
   * after an exact subscribe.
   */
  retain?: Duration;
  /**
   * Ephemeral topic: never stored; may be throttled and dropped for slow
   * connections.
   */
  ephemeral?: boolean;
  /**
   * Minimum interval between messages from the same publisher on the same
   * topic. Intermediate messages are dropped, the latest one is delivered at
   * the end of the interval.
   */
  throttle?: Duration;
  /**
   * Allow clients to publish on matching topics (deny by default).
   */
  publish?: boolean | ClientPublishPolicy<P>;
  /**
   * Allow clients to send requests to other clients on matching topics.
   * Requests to handlers and routes are always allowed (subject to
   * `authorize`).
   */
  request?: boolean;
  /**
   * Pro only: ordered topic with a history window.
   */
  ordered?: unknown;
  /**
   * Pro only: track presence on matching topics.
   */
  presence?: unknown;
}

export interface ResolvedTopicPolicy<P = any> {
  pattern: string;
  policy: TopicPolicy<P>;
  retainMs?: number;
  throttleMs?: number;
  publish?: {
    maxSize?: number;
    rateLimit?: { max: number; durationMs: number };
    onPublish?: ClientPublishPolicy<P>['onPublish'];
    echo: EchoMode;
  };
}

/**
 * Registry of topic policies. The most specific matching pattern wins.
 */
export class TopicPolicies<P = any> {
  private entries: ResolvedTopicPolicy<P>[] = [];
  private cache = new Map<string, ResolvedTopicPolicy<P> | null>();

  constructor(
    private readonly options: {
      /** Rejects options that are not available in this edition. */
      validate?: (pattern: string, policy: TopicPolicy<P>) => void;
    } = {},
  ) {}

  define(pattern: string, policy: TopicPolicy<P>): void {
    validatePattern(pattern);
    if (this.entries.some(entry => entry.pattern === pattern)) {
      throw new RelayError(
        'bad_request',
        `A topic policy for "${pattern}" is already defined`,
      );
    }
    if (policy.retain !== undefined && policy.ephemeral) {
      throw new RelayError(
        'bad_request',
        `Topic policy "${pattern}": retain and ephemeral are mutually exclusive`,
      );
    }
    this.options.validate?.(pattern, policy);

    const resolved: ResolvedTopicPolicy<P> = { pattern, policy };
    if (policy.retain !== undefined) {
      resolved.retainMs = parseDuration(policy.retain, 'retain');
    }
    if (policy.throttle !== undefined) {
      resolved.throttleMs = parseDuration(policy.throttle, 'throttle');
    }
    if (policy.publish) {
      const publish = policy.publish === true ? {} : policy.publish;
      resolved.publish = {
        maxSize:
          publish.maxSize !== undefined
            ? parseSize(publish.maxSize, 'maxSize')
            : undefined,
        rateLimit: publish.rateLimit
          ? {
              max: publish.rateLimit.max,
              durationMs: parseDuration(
                publish.rateLimit.duration,
                'rateLimit.duration',
              ),
            }
          : undefined,
        onPublish: publish.onPublish,
        echo: publish.echo || 'others',
      };
    }

    this.entries.push(resolved);
    this.entries.sort((a, b) => compareSpecificity(a.pattern, b.pattern));
    this.cache.clear();
  }

  /**
   * Returns the most specific policy matching `topic`, if any.
   */
  resolve(topic: string): ResolvedTopicPolicy<P> | undefined {
    const cached = this.cache.get(topic);
    if (cached !== undefined) {
      return cached || undefined;
    }
    const found = this.entries.find(entry => matchTopic(entry.pattern, topic));
    if (this.cache.size > 10_000) {
      this.cache.clear();
    }
    this.cache.set(topic, found || null);
    return found;
  }

  /**
   * Stable fingerprint of the declared policies, used to detect nodes that
   * run with different policies.
   */
  fingerprint(): string {
    const normalized = [...this.entries]
      .sort((a, b) => (a.pattern < b.pattern ? -1 : 1))
      .map(entry => [entry.pattern, normalize(entry.policy)]);
    return createHash('sha1')
      .update(JSON.stringify(normalized))
      .digest('hex')
      .slice(0, 16);
  }

  get size(): number {
    return this.entries.length;
  }
}

function normalize(value: unknown): unknown {
  if (typeof value === 'function') {
    return '<fn>';
  }
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce(
        (acc, key) => {
          acc[key] = normalize((value as any)[key]);
          return acc;
        },
        {} as Record<string, unknown>,
      );
  }
  return value;
}

/**
 * Extracts the values captured by the wildcards of `pattern` in `topic`.
 *
 * @example params('chat.rooms.*.messages', 'chat.rooms.42.messages') → ['42']
 */
export function topicParams(pattern: string, topic: string): string[] {
  const p = pattern.split('.');
  const t = topic.split('.');
  const params: string[] = [];
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '*') {
      params.push(t[i]);
    } else if (p[i] === '>') {
      params.push(t.slice(i).join('.'));
      break;
    }
  }
  return params;
}
