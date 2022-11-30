import { v4 } from 'uuid';

/**
 * Keeps track on timers created with setTimeout to help clearTimeout
 * for all timers when no more delayed actions needed
 */
export class TimerManager {
  private readonly timers = new Map<
    string,
    {
      name: string;
      timer: NodeJS.Timeout;
    }
  >();

  /**
   * Creates a new timer and returns its ID.
   *
   * @param name - Readable name for the timer
   * @param delay - Delay in milliseconds
   * @param fn - Callback function that is executed after the timer expires
   */
  public setTimer(name: string, delay: number, fn: Function): string {
    const id = v4();
    const timer = setTimeout(
      timeoutId => {
        this.clearTimer(timeoutId);
        try {
          fn();
        } catch (err) {
          console.error(err);
        }
      },
      delay,
      id,
    );

    this.timers.set(id, {
      name,
      timer,
    });

    return id;
  }

  public clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer.timer);
      this.timers.delete(id);
    }
  }

  public clearAllTimers(): void {
    for (const id of this.timers.keys()) {
      this.clearTimer(id);
    }
  }
}
