import { v4 } from 'uuid';

/**
 * Keeps track on timers created with setTimeout to help clearTimeout
 * for all timers when no more delayed actions needed
 */
export class TimerManager {
  private timers: any = {};

  public setTimer(name: string, delay: number, fn: Function) {
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

    // XXX only the timer is used, but the
    // other fields are useful for
    // troubleshooting/debugging
    this.timers[id] = {
      name,
      timer,
    };

    return id;
  }

  public clearTimer(id: string) {
    const timers = this.timers;
    const timer = timers[id];
    if (!timer) {
      return;
    }
    clearTimeout(timer.timer);
    delete timers[id];
  }

  public clearAllTimers() {
    Object.keys(this.timers).forEach(key => {
      this.clearTimer(key);
    });
  }
}
