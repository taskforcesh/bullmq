/**
 * Regression tests for `hasLegacyRepeatableKeyShape`.
 *
 * Legacy (v5) repeatable keys are built by `Repeat.getRepeatConcatOptions` as
 *
 *   `${name}:${jobId}:${endDate}:${tz}:${suffix}`
 *
 * where `suffix` is either the cron `pattern` or `String(every)`. The shape
 * detector recognised a cron suffix only by looking for a space, so the
 * predefined cron aliases accepted by cron-parser (`@daily`, `@hourly`, ...)
 * — which contain no spaces and are not numeric — were classified as *not*
 * legacy. The worker then treats such a key as a Job Scheduler id and calls
 * `upsertJobScheduler` on it instead of raising the migration error.
 *
 * These tests exercise the pure key-shape predicate, so they need no Redis.
 */
import { describe, it, expect } from 'vitest';
import { CronExpressionParser } from 'cron-parser';
import { PredefinedExpressions } from 'cron-parser/dist/CronExpressionParser';
import {
  hasLegacyRepeatableKeyShape,
  isLegacyRepeatableJobKey,
} from '../src/classes/job-scheduler';

// The space-free cron patterns cron-parser accepts, i.e. every alias that can
// legitimately appear as the suffix of a legacy repeatable key.
const predefinedAliases = [
  '@yearly',
  '@annually',
  '@monthly',
  '@weekly',
  '@daily',
  '@hourly',
  '@minutely',
  '@secondly',
  '@weekdays',
  '@weekends',
];

describe('hasLegacyRepeatableKeyShape', () => {
  describe('when the legacy key suffix is a predefined cron alias', () => {
    it.each(predefinedAliases)(
      'should detect the legacy key shape for %s',
      alias => {
        expect(hasLegacyRepeatableKeyShape(`myjob::::${alias}`)).toBe(true);
      },
    );

    it('should detect the legacy key shape with jobId, endDate and tz filled in', () => {
      expect(
        hasLegacyRepeatableKeyShape(
          'myjob:job-id-1:1735689600000:Europe/Athens:@daily',
        ),
      ).toBe(true);
    });

    it('should detect the legacy key shape with an empty endDate', () => {
      expect(hasLegacyRepeatableKeyShape('myjob:job-id::UTC:@daily')).toBe(
        true,
      );
    });

    it('should detect the legacy key shape through the isLegacyRepeatableJobKey alias', () => {
      expect(isLegacyRepeatableJobKey('myjob::::@hourly')).toBe(true);
    });
  });

  describe('when the suffix only resembles a predefined cron alias', () => {
    // Each row pins the alias match to exact equality against the list above.
    // All three are controls: they are already non-legacy without the fix, and
    // they fail if the alias check is loosened to a prefix or substring test.
    it.each([
      ['an unknown alias (control)', 'myjob::::@nightly'],
      ['an alias with the wrong case (control)', 'myjob::::@Daily'],
      ['a suffix embedding an alias (control)', 'myjob::::@daily-report'],
    ])('should not detect the legacy key shape for %s', (_label, key) => {
      expect(hasLegacyRepeatableKeyShape(key)).toBe(false);
      // The list is exact because cron-parser itself rejects these.
      expect(() =>
        CronExpressionParser.parse(key.substring(key.lastIndexOf(':') + 1), {
          currentDate: new Date('2026-03-05T10:20:30Z'),
        }),
      ).toThrow();
    });

    it('should keep the alias check behind the endDate guard (control)', () => {
      // A non-numeric endDate segment disqualifies the key before the suffix
      // is examined; this fails if the alias branch is hoisted above it.
      expect(hasLegacyRepeatableKeyShape('myjob:id:not-a-date::@daily')).toBe(
        false,
      );
    });
  });

  describe('when the legacy key suffix is a space-separated pattern or an every interval', () => {
    it('should detect the legacy key shape for a cron pattern with spaces (control)', () => {
      expect(hasLegacyRepeatableKeyShape('myjob::::0 15 3 * * *')).toBe(true);
    });

    it('should detect the legacy key shape for a numeric every interval (control)', () => {
      expect(hasLegacyRepeatableKeyShape('myjob::::60000')).toBe(true);
    });

    it('should detect the legacy key shape for numeric zero (control)', () => {
      expect(hasLegacyRepeatableKeyShape('myjob::::0')).toBe(true);
    });

    it('should not detect the legacy key shape for an undefined suffix (control)', () => {
      expect(hasLegacyRepeatableKeyShape('myjob::::undefined')).toBe(false);
    });

    it('should not detect the legacy key shape for fewer than 5 segments (control)', () => {
      expect(hasLegacyRepeatableKeyShape('myjob:id:@daily')).toBe(false);
    });
  });

  it('should match cron-parser’s complete predefined alias table', () => {
    const parserAliases = Object.keys(PredefinedExpressions);

    expect(predefinedAliases).toEqual(parserAliases);
    for (const alias of parserAliases) {
      expect(hasLegacyRepeatableKeyShape(`myjob::::${alias}`)).toBe(true);
    }
  });

  it('should only list aliases that cron-parser can parse (control)', () => {
    // Guards the alias list against drift in cron-parser: every entry must be
    // a pattern a legacy repeatable job could actually have been created with.
    for (const alias of predefinedAliases) {
      expect(() =>
        CronExpressionParser.parse(alias, {
          currentDate: new Date('2026-03-05T10:20:30Z'),
        }),
      ).not.toThrow();
    }
  });
});
