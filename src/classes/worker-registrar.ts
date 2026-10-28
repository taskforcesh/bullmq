import { hostname } from 'node:os';
import { IQueueBackend, WorkerRegistryOptions } from '../interfaces';
import { version as packageVersion } from '../version';

/**
 * Keeps a Worker registered in its queue's worker registry, the way a Relay
 * keeps its node registered: a lease renewed by a heartbeat timer, and a sweep
 * timer that removes the expired registrations of the queue.
 */
export class WorkerRegistrar {
  private readonly leaseDuration: number;
  private heartbeatTimer?: NodeJS.Timeout;
  private sweepTimer?: NodeJS.Timeout;
  private starting?: Promise<void>;
  private heartbeating?: Promise<void>;
  private sweeping?: Promise<void>;
  private closing = false;

  constructor(
    private readonly backend: IQueueBackend,
    private readonly workerId: string,
    private readonly name: string | undefined,
    private readonly opts: WorkerRegistryOptions,
    private readonly emitError: (err: Error) => void,
  ) {
    this.leaseDuration = opts.leaseDuration ?? 30_000;
  }

  /** Throws when an option is not a valid duration, like the relay's. */
  static validate(opts: WorkerRegistryOptions = {}): void {
    for (const name of [
      'leaseDuration',
      'heartbeatInterval',
      'sweepInterval',
    ] as const) {
      const value = opts[name];
      if (
        value !== undefined &&
        (!Number.isInteger(value) || value <= 0 || value > 2_147_483_647)
      ) {
        throw new Error(`Invalid worker registry ${name}: ${value}`);
      }
    }
  }

  /**
   * Registers the Worker and starts the timers. Unlike a relay node's, a
   * failed registration does not stop the Worker: it is reported, and the
   * next heartbeat registers again.
   */
  start(): Promise<void> {
    if (this.closing) {
      return Promise.resolve();
    }
    if (!this.starting) {
      this.starting = (async () => {
        await this.register().catch(err => this.emitError(err));
        if (this.closing) {
          return;
        }
        const heartbeatInterval =
          this.opts.heartbeatInterval ??
          Math.max(1, Math.floor(this.leaseDuration / 3));
        this.heartbeatTimer = setInterval(
          () => this.heartbeat().catch(err => this.emitError(err)),
          heartbeatInterval,
        );
        this.sweepTimer = setInterval(
          () => this.sweep().catch(err => this.emitError(err)),
          this.opts.sweepInterval ?? this.leaseDuration,
        );
      })();
    }
    return this.starting;
  }

  /** Stops the timers and unregisters the Worker (best-effort). */
  async close(force = false): Promise<void> {
    if (this.closing) {
      return;
    }
    this.closing = true;
    clearInterval(this.heartbeatTimer);
    clearInterval(this.sweepTimer);
    if (force) {
      return;
    }
    await this.starting;
    await this.heartbeating?.catch((): void => undefined);
    await this.sweeping?.catch((): void => undefined);
    if (this.starting) {
      await this.backend.unregisterWorker(this.workerId);
    }
  }

  private register(): Promise<void> {
    return this.backend.registerWorker(this.workerId, this.leaseDuration, {
      name: this.name,
      host: hostname(),
      pid: process.pid,
      version: packageVersion,
    });
  }

  private heartbeat(): Promise<void> {
    // A slow datastore must not pile up overlapping heartbeats: skip the tick
    // while the previous one runs.
    if (this.closing) {
      return Promise.resolve();
    }
    if (this.heartbeating) {
      return Promise.resolve();
    }
    this.heartbeating = (async () => {
      const alive = await this.backend.heartbeatWorker(
        this.workerId,
        this.leaseDuration,
      );
      // The Worker's lease expired or it was swept: register again.
      if (!alive && !this.closing) {
        await this.register();
      }
    })().finally(() => {
      this.heartbeating = undefined;
    });
    return this.heartbeating;
  }

  private sweep(): Promise<void> {
    if (this.closing || this.sweeping) {
      return Promise.resolve();
    }
    this.sweeping = (async () => {
      await this.backend.sweepWorkers(100);
    })().finally(() => {
      this.sweeping = undefined;
    });
    return this.sweeping;
  }
}
