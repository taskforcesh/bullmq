import {
  validateKeepJobsAge,
  MAX_REASONABLE_KEEP_JOBS_AGE_SECONDS,
} from '../src/utils';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Regression test for issue #3540 — "Jobs auto-removed from queue with no
// logs". The reporter passed `removeOn*.age` values in milliseconds (e.g.
// `7 * 24 * 60 * 60 * 1000`) instead of seconds. The validator emits a
// one-time warning when the age value looks suspiciously large so the unit
// confusion is surfaced instead of silently producing nonsensical retention
// behavior.
describe('validateKeepJobsAge', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('does not warn for sane second-based values (7 days)', () => {
    validateKeepJobsAge({ age: 7 * 24 * 60 * 60 }, 'unit-test:7-days');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn for sane second-based values (30 days)', () => {
    validateKeepJobsAge({ age: 30 * 24 * 60 * 60 }, 'unit-test:30-days');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn at exactly the threshold (10 years)', () => {
    validateKeepJobsAge(
      { age: MAX_REASONABLE_KEEP_JOBS_AGE_SECONDS },
      'unit-test:threshold',
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn for a 1-year retention in seconds', () => {
    validateKeepJobsAge(
      { age: 365 * 24 * 60 * 60 },
      'unit-test:1-year',
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns when `age` is provided in milliseconds (7 days as ms)', () => {
    // This is the literal value from issue #3540.
    const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
    validateKeepJobsAge(
      { age: sevenDaysInMs },
      'unit-test:3540-removeOnComplete',
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const message = warnSpy.mock.calls[0][0] as string;
    expect(message).toContain('unit-test:3540-removeOnComplete');
    expect(message).toContain('SECONDS');
    expect(message).toContain('3540');
    // It should suggest the correct value (age / 1000).
    expect(message).toContain(`${sevenDaysInMs / 1000}`);
  });

  it('warns when `age` is provided in milliseconds (30 days as ms)', () => {
    const thirtyDaysInMs = 30 * 24 * 60 * 60 * 1000;
    validateKeepJobsAge(
      { age: thirtyDaysInMs },
      'unit-test:3540-removeOnFail',
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('only warns once per (context, value) pair', () => {
    const value = 7 * 24 * 60 * 60 * 1000;
    validateKeepJobsAge({ age: value }, 'unit-test:dedup');
    validateKeepJobsAge({ age: value }, 'unit-test:dedup');
    validateKeepJobsAge({ age: value }, 'unit-test:dedup');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('does not warn when keepJobs is undefined / boolean / number', () => {
    validateKeepJobsAge(undefined, 'ctx');
    validateKeepJobsAge(true, 'ctx');
    validateKeepJobsAge(false, 'ctx');
    validateKeepJobsAge(100, 'ctx');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn when keepJobs has only `count` (no age)', () => {
    validateKeepJobsAge({ count: 1000 }, 'unit-test:count-only');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('ignores non-numeric / non-finite age values', () => {
    validateKeepJobsAge({ age: NaN }, 'unit-test:nan');
    validateKeepJobsAge({ age: Infinity }, 'unit-test:inf');
    validateKeepJobsAge(
      { age: 'oops' as unknown as number },
      'unit-test:string',
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
