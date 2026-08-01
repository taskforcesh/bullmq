using System.Globalization;
using Cronos;

namespace BullMQ;

/// <summary>
/// Computes the next execution time (ms since epoch) for a set of repeat
/// options, supporting both the fixed-interval (<c>every</c>) and cron
/// (<c>pattern</c>) strategies. Port of the reference <c>getNextMillis</c>.
/// </summary>
internal static class RepeatStrategy
{
    public static long? GetNextMillis(long millis, RepeatOptions opts)
    {
        if (opts.Pattern is not null && opts.Every is not null)
        {
            throw new ArgumentException(
                "Both .pattern and .every options are defined for this repeatable job");
        }

        if (opts.Every is { } every)
        {
            if (every <= 0)
            {
                throw new ArgumentException(".every must be a positive number of milliseconds");
            }

            return (millis / every) * every + ((opts.Immediately ?? false) ? 0 : every);
        }

        if (opts.Pattern is not { } pattern)
        {
            return null;
        }

        if (opts.Immediately ?? false)
        {
            return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        var startMs = ToMillis(opts.StartDate);
        var baseMs = startMs is { } sd && sd > millis ? sd : millis;

        var expression = ParseCron(pattern);
        var zone = ResolveTimeZone(opts.Tz);

        var fromUtc = DateTimeOffset.FromUnixTimeMilliseconds(baseMs).UtcDateTime;
        var next = expression.GetNextOccurrence(fromUtc, zone);
        return next is { } n ? new DateTimeOffset(n, TimeSpan.Zero).ToUnixTimeMilliseconds() : null;
    }

    private static CronExpression ParseCron(string pattern)
    {
        var fieldCount = pattern.Split(' ', StringSplitOptions.RemoveEmptyEntries).Length;
        var format = fieldCount >= 6 ? CronFormat.IncludeSeconds : CronFormat.Standard;
        return CronExpression.Parse(pattern, format);
    }

    private static TimeZoneInfo ResolveTimeZone(string? tz)
    {
        if (string.IsNullOrEmpty(tz))
        {
            return TimeZoneInfo.Utc;
        }

        return TimeZoneInfo.FindSystemTimeZoneById(tz);
    }

    /// <summary>Coerces a date-ish value (ms int or ISO 8601 string) to epoch ms.</summary>
    public static long? ToMillis(object? value)
    {
        switch (value)
        {
            case null:
                return null;
            case long l:
                return l;
            case int i:
                return i;
            case double d:
                return (long)d;
            case string s when long.TryParse(s, out var ms):
                return ms;
            case string s when DateTimeOffset.TryParse(
                s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var dto):
                return dto.ToUnixTimeMilliseconds();
            default:
                return null;
        }
    }
}
