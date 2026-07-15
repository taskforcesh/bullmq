/**
 * (c) 2017-2025 BullForce Labs AB, MIT Licensed.
 * @see LICENSE.md
 *
 */

class Node<T> {
  value: T | undefined = undefined;
  next: Node<T> | null = null;

  constructor(value: T) {
    this.value = value;
  }
}

class LinkedList<T> {
  length = 0;
  private head: Node<T> | null;
  private tail: Node<T> | null;

  constructor() {
    this.head = null;
    this.tail = null;
  }

  push(value: T) {
    const newNode = new Node(value);
    if (!this.length) {
      this.head = newNode;
    } else {
      this.tail.next = newNode;
    }

    this.tail = newNode;
    this.length += 1;
    return newNode;
  }

  shift() {
    if (!this.length) {
      return null;
    } else {
      const head = this.head;
      this.head = this.head.next;
      this.length -= 1;

      return head;
    }
  }
}

/**
 * AsyncFifoQueue
 *
 * A minimal FIFO queue for asynchronous operations. Allows adding asynchronous operations
 * and consume them in the order they are resolved.
 */
export class AsyncFifoQueue<T> {
  /**
   * A queue of completed promises. As the pending
   * promises are resolved, they are added to this queue.
   */
  private queue: LinkedList<T> = new LinkedList();

  /**
   * A set of pending promises.
   */
  private pending = new Set<Promise<T>>();

  /**
   * The next promise to be resolved. As soon as a pending promise
   * is resolved, this promise is resolved with the result of the
   * pending promise.
   */
  private nextPromise: Promise<T | undefined> | undefined;
  private resolve: ((value: T | undefined) => void) | undefined;
  private reject: ((reason?: any) => void) | undefined;

  constructor(private ignoreErrors = false) {
    this.newPromise();
  }

  /**
   * Adds a promise to the queue. When it resolves, its value is enqueued
   * and, if a consumer is waiting via {@link fetch}, the next pending
   * promise is resolved with the value.
   *
   * @param promise - The asynchronous operation to add to the queue.
   */
  public add(promise: Promise<T>): void {
    this.pending.add(promise);

    promise
      .then(data => {
        this.pending.delete(promise);

        if (this.queue.length === 0) {
          this.resolvePromise(data);
        }
        this.queue.push(data);
      })
      .catch(err => {
        // Ignore errors
        if (this.ignoreErrors) {
          this.queue.push(undefined);
        }
        this.pending.delete(promise);
        this.rejectPromise(err);
      });
  }

  /**
   * Waits for all currently pending promises to settle.
   *
   * @returns A promise that resolves once every in-flight promise has resolved.
   */
  public async waitAll(): Promise<void> {
    await Promise.all(this.pending);
  }

  /**
   * Returns the total number of items currently tracked by the queue,
   * including both pending (in-flight) promises and resolved items that
   * have not yet been fetched.
   *
   * @returns The sum of pending and queued items.
   */
  public numTotal(): number {
    return this.pending.size + this.queue.length;
  }

  /**
   * Returns the number of promises that are still pending (in-flight).
   *
   * @returns The number of unresolved promises currently in the queue.
   */
  public numPending(): number {
    return this.pending.size;
  }

  /**
   * Returns the number of items that have already resolved but have not
   * yet been fetched by a consumer.
   *
   * @returns The number of resolved items waiting to be consumed.
   */
  public numQueued(): number {
    return this.queue.length;
  }

  private resolvePromise(data: T) {
    this.resolve!(data);
    this.newPromise();
  }

  private rejectPromise(err: any) {
    this.reject!(err);
    this.newPromise();
  }

  private newPromise() {
    this.nextPromise = new Promise<T | undefined>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }

  private async wait() {
    return this.nextPromise;
  }

  /**
   * Fetches the next resolved item from the queue in FIFO order. If no
   * items are currently resolved but pending promises exist, it waits
   * until the next one resolves.
   *
   * @returns The next resolved value, or `undefined` if there are no
   * pending or queued items.
   */
  public async fetch(): Promise<T | void> {
    if (this.pending.size === 0 && this.queue.length === 0) {
      return;
    }
    while (this.queue.length === 0) {
      try {
        await this.wait();
      } catch (err) {
        // Ignore errors
        if (!this.ignoreErrors) {
          console.error('Unexpected Error in AsyncFifoQueue', err);
        }
      }
    }
    return this.queue.shift()?.value;
  }
}
