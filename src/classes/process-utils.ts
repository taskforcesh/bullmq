'use strict';

import { ChildProcess } from 'child_process';

function onExitOnce(child: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    child.once('exit', () => resolve());
  });
}

function hasProcessExited(child: ChildProcess): boolean {
  return !!(child.exitCode !== null || child.signalCode);
}

/**
 * Sends a kill signal to a child resolving when the child has exited,
 * resorting to SIGKILL if the given timeout is reached
 */
export async function killAsync(
  child: ChildProcess,
  signal: 'SIGTERM' | 'SIGKILL' = 'SIGKILL',
  timeoutMs: number = undefined,
): Promise<void> {
  if (hasProcessExited(child)) {
    return;
  }

  const onExit = onExitOnce(child);
  child.kill(signal);

  if (timeoutMs === 0 || isFinite(timeoutMs)) {
    const timeoutHandle = setTimeout(() => {
      if (!hasProcessExited(child)) {
        child.kill('SIGKILL');
      }
    }, timeoutMs);
    await onExit;
    clearTimeout(timeoutHandle);
  }
  await onExit;
}
