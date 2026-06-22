/**
 * Regression test for https://github.com/taskforcesh/bullmq/issues/2232
 *
 * Symptom: under Bun, `worker_threads.Worker` ignores the `stdin`/`stdout`/
 * `stderr` options ("[bun] Warning: worker_threads.Worker option \"stdout\"
 * is not implemented."), so `parent.stdout` and `parent.stderr` end up `null`.
 * `Child.init()` then crashes with:
 *
 *   TypeError: null is not an object (evaluating 'parent.stdout.pipe')
 *
 * The fix is to guard the pipe calls (`parent.stdout?.pipe(process.stdout)`).
 *
 * This test cannot run Bun in CI, so it instead mocks `child_process.fork` to
 * return a fake child whose `stdout` and `stderr` are both `null`, which
 * mirrors the Bun condition exactly. Without the guard the test fails with
 * the same TypeError; with the guard `init()` proceeds normally.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock `child_process` so that `fork()` returns a fake child with null stdio.
// We keep `spawn`/`exec`/etc. untouched in case they get pulled in by other
// transitive imports.
//
// IMPORTANT: `vi.mock` factory functions are hoisted above all imports, so we
// cannot reference any module-scope import inside the factory. The
// `ChildCommand.Init` and `ParentCommand.InitCompleted` enum string values are
// inlined below to avoid hoisting issues.
vi.mock('child_process', () => {
  // Mirror enum values from ../src/enums (kept in sync manually because the
  // mock factory is hoisted above imports). These are numeric enums:
  //   ChildCommand.Init        === 0
  //   ParentCommand.InitCompleted === 4
  const CHILD_INIT = 0;
  const PARENT_INIT_COMPLETED = 4;

  // `require` is used here on purpose: the factory is hoisted above all ES
  // module imports by vitest, so we cannot rely on a top-level
  // `import { EventEmitter } from 'events'`.
  const { EventEmitter } = require('events');

  // A fake ChildProcess: EventEmitter + null stdout/stderr + a working `send`.
  class FakeChild extends EventEmitter {
    public stdout = null;
    public stderr = null;
    public stdin = null;
    public pid = 12345;
    public killed = false;
    public connected = true;

    send(msg: any, cb?: (err: Error | null) => void): boolean {
      // Reply to the Init command with InitCompleted on the next tick so the
      // parent's `initChild()` promise resolves.
      if (msg && msg.cmd === CHILD_INIT) {
        setImmediate(() => {
          this.emit('message', { cmd: PARENT_INIT_COMPLETED });
        });
      }
      if (cb) {
        setImmediate(() => cb(null));
      }
      return true;
    }

    kill(_signal?: string): boolean {
      this.killed = true;
      setImmediate(() => {
        this.emit('exit', 0, null);
      });
      return true;
    }

    disconnect() {
      this.connected = false;
    }
  }

  return {
    fork: () => new FakeChild() as any,
    // The other named exports are not used by `Child`, but provide stubs so
    // any other consumer transitively pulled in by the test does not blow up.
    spawn: () => {
      throw new Error('spawn is not mocked in this test');
    },
    exec: () => {
      throw new Error('exec is not mocked in this test');
    },
    execFile: () => {
      throw new Error('execFile is not mocked in this test');
    },
    execSync: () => {
      throw new Error('execSync is not mocked in this test');
    },
    spawnSync: () => {
      throw new Error('spawnSync is not mocked in this test');
    },
    execFileSync: () => {
      throw new Error('execFileSync is not mocked in this test');
    },
    default: {},
  };
});

import { Child } from '../src/classes/child';
import { ChildCommand, ParentCommand } from '../src/enums';

describe('Child.init with null stdout/stderr', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the inlined enum values in the mock in sync with the real enums', () => {
    // Guard against silent drift: if either enum value changes, the mock's
    // hard-coded numeric values must change too.
    expect(ChildCommand.Init).toBe(0);
    expect(ParentCommand.InitCompleted).toBe(4);
  });

  it('does not throw a TypeError when parent.stdout and parent.stderr are null', async () => {
    const child = new Child(
      // mainFile/processFile values are unused because `fork` is mocked.
      '/unused/main.js',
      '/unused/processor.js',
      { useWorkerThreads: false },
    );

    // Without the null-guard in src/classes/child.ts this rejects with:
    //   TypeError: Cannot read properties of null (reading 'pipe')
    // (or, on Bun: "null is not an object (evaluating 'parent.stdout.pipe')")
    await expect(child.init()).resolves.toBeUndefined();

    // Sanity-check that we really did simulate the Bun condition.
    expect(child.childProcess.stdout).toBeNull();
    expect(child.childProcess.stderr).toBeNull();

    await child.kill();
  });
});
