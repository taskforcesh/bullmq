namespace BullMQ;

/// <summary>
/// A custom backoff strategy, used for jobs whose <see cref="BackoffOptions.Type"/>
/// is not one of the built-in strategies (<c>"fixed"</c>, <c>"exponential"</c>).
/// Mirrors the reference <c>settings.backoffStrategy</c> worker option.
/// </summary>
/// <param name="attemptsMade">The attempt that just failed (1 for the first failure).</param>
/// <param name="type">The job's backoff type.</param>
/// <param name="error">The error thrown by the processor.</param>
/// <param name="job">The failed job.</param>
/// <returns>
/// The delay in milliseconds before the job is retried. Return <c>0</c> (or any
/// other non-positive value) to retry immediately, or <c>-1</c> to stop retrying
/// and move the job to the failed state.
/// </returns>
public delegate Task<long> BackoffStrategy(int attemptsMade, string type, Exception error, Job job);

/// <summary>Computes retry delays for failed jobs, matching the reference runtimes.</summary>
internal static class Backoffs
{
    /// <summary>
    /// Returns the delay (ms) before the next attempt, <c>-1</c> when the job
    /// must not be retried, or <c>null</c> when the job has no backoff.
    /// </summary>
    public static async Task<long?> CalculateAsync(
        BackoffOptions? backoff,
        int attemptsMade,
        Exception error,
        Job job,
        BackoffStrategy? customStrategy,
        Func<double>? random = null)
    {
        if (backoff is null)
        {
            return null;
        }

        var nextDouble = random ?? Random.Shared.NextDouble;
        var jitter = backoff.Jitter ?? 0;

        switch (backoff.Type)
        {
            case "fixed":
                return Fixed(backoff.Delay, jitter, nextDouble);
            case "exponential":
                return Exponential(backoff.Delay, attemptsMade, jitter, nextDouble);
        }

        if (customStrategy is null)
        {
            throw new BullMQException(
                $"Unknown backoff strategy {backoff.Type}. If a custom backoff strategy is used, " +
                "specify it with WorkerOptions.BackoffStrategy when the worker is created.");
        }

        return await customStrategy(attemptsMade, backoff.Type, error, job).ConfigureAwait(false);
    }

    private static long Fixed(long delay, double jitter, Func<double> random)
    {
        if (jitter > 0)
        {
            var minDelay = delay * (1 - jitter);
            return ToMs(Math.Floor(random() * delay * jitter + minDelay));
        }

        return delay;
    }

    private static long Exponential(long delay, int attemptsMade, double jitter, Func<double> random)
    {
        var maxDelay = Math.Round(Math.Pow(2, attemptsMade - 1) * delay, MidpointRounding.AwayFromZero);
        if (jitter > 0)
        {
            var minDelay = maxDelay * (1 - jitter);
            return ToMs(Math.Floor(random() * maxDelay * jitter + minDelay));
        }

        return ToMs(maxDelay);
    }

    // Saturate instead of relying on unspecified out-of-range double -> long casts.
    private static long ToMs(double value) => value >= long.MaxValue ? long.MaxValue : (long)value;
}
