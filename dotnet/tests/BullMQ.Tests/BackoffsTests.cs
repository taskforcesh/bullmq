using BullMQ;
using Xunit;

namespace BullMQ.Tests;

public class BackoffsTests
{
    private static readonly Exception Error = new InvalidOperationException("boom");

    private static Job NewJob(BackoffOptions? backoff = null) =>
        new(null!, "backoffs", "job", null, new JobsOptions { Attempts = 5, Backoff = backoff });

    private static Task<long?> CalculateAsync(
        BackoffOptions? backoff, int attemptsMade, BackoffStrategy? custom = null, Func<double>? random = null) =>
        Backoffs.CalculateAsync(backoff, attemptsMade, Error, NewJob(backoff), custom, random);

    [Fact]
    public async Task NoBackoff_ReturnsNull()
    {
        Assert.Null(await CalculateAsync(null, 1));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(7)]
    public async Task Fixed_ReturnsDelayForEveryAttempt(int attemptsMade)
    {
        var backoff = new BackoffOptions { Type = "fixed", Delay = 1500 };
        Assert.Equal(1500, await CalculateAsync(backoff, attemptsMade));
    }

    [Theory]
    [InlineData(1, 1000)]
    [InlineData(2, 2000)]
    [InlineData(3, 4000)]
    [InlineData(4, 8000)]
    [InlineData(10, 512000)]
    public async Task Exponential_DoublesPerAttempt(int attemptsMade, long expected)
    {
        var backoff = new BackoffOptions { Type = "exponential", Delay = 1000 };
        Assert.Equal(expected, await CalculateAsync(backoff, attemptsMade));
    }

    [Fact]
    public async Task Exponential_HugeAttempts_Saturates()
    {
        var backoff = new BackoffOptions { Type = "exponential", Delay = 1000 };
        Assert.Equal(long.MaxValue, await CalculateAsync(backoff, 200));
    }

    [Fact]
    public async Task Exponential_WithJitter_StaysWithinBounds()
    {
        var backoff = new BackoffOptions { Type = "exponential", Delay = 1000, Jitter = 0.5 };

        // attempt 3 -> max 4000, min 4000 * (1 - 0.5) = 2000.
        Assert.Equal(2000, await CalculateAsync(backoff, 3, random: () => 0));
        Assert.Equal(3000, await CalculateAsync(backoff, 3, random: () => 0.5));
        Assert.Equal(3999, await CalculateAsync(backoff, 3, random: () => 0.99999));

        var seen = new HashSet<long>();
        for (var i = 0; i < 1000; i++)
        {
            var delay = (await CalculateAsync(backoff, 3))!.Value;
            Assert.InRange(delay, 2000, 3999);
            seen.Add(delay);
        }

        Assert.True(seen.Count > 1, "jitter should randomize the delay");
    }

    [Fact]
    public async Task Exponential_WithFullJitter_CanBeZero()
    {
        var backoff = new BackoffOptions { Type = "exponential", Delay = 1000, Jitter = 1 };
        Assert.Equal(0, await CalculateAsync(backoff, 2, random: () => 0));
        Assert.Equal(1999, await CalculateAsync(backoff, 2, random: () => 0.99999));
    }

    [Fact]
    public async Task Fixed_WithJitter_StaysWithinBounds()
    {
        var backoff = new BackoffOptions { Type = "fixed", Delay = 1000, Jitter = 0.2 };

        Assert.Equal(800, await CalculateAsync(backoff, 4, random: () => 0));
        Assert.Equal(999, await CalculateAsync(backoff, 4, random: () => 0.99999));

        for (var i = 0; i < 1000; i++)
        {
            Assert.InRange((await CalculateAsync(backoff, 1))!.Value, 800, 999);
        }
    }

    [Fact]
    public async Task UnknownType_WithoutCustomStrategy_Throws()
    {
        var backoff = new BackoffOptions { Type = "linear", Delay = 100 };
        var ex = await Assert.ThrowsAsync<BullMQException>(() => CalculateAsync(backoff, 1));
        Assert.Contains("Unknown backoff strategy linear", ex.Message);
    }

    [Fact]
    public async Task UnknownType_UsesCustomStrategy()
    {
        var backoff = new BackoffOptions { Type = "linear", Delay = 100 };
        var job = NewJob(backoff);
        (int attemptsMade, string type, Exception error, Job job)? call = null;

        var delay = await Backoffs.CalculateAsync(backoff, 3, Error, job, (attemptsMade, type, error, j) =>
        {
            call = (attemptsMade, type, error, j);
            return Task.FromResult(attemptsMade * 100L);
        });

        Assert.Equal(300, delay);
        Assert.NotNull(call);
        Assert.Equal(3, call!.Value.attemptsMade);
        Assert.Equal("linear", call.Value.type);
        Assert.Same(Error, call.Value.error);
        Assert.Same(job, call.Value.job);
    }

    [Fact]
    public async Task BuiltInType_IgnoresCustomStrategy()
    {
        var backoff = new BackoffOptions { Type = "fixed", Delay = 100 };
        var delay = await CalculateAsync(backoff, 1, (_, _, _, _) => Task.FromResult(-1L));
        Assert.Equal(100, delay);
    }

    [Theory]
    [InlineData(-0.1)]
    [InlineData(1.1)]
    [InlineData(double.NaN)]
    public void Jitter_OutOfRange_Throws(double jitter)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new BackoffOptions { Jitter = jitter });
    }

    [Theory]
    [InlineData(0)]
    [InlineData(0.5)]
    [InlineData(1)]
    public void Jitter_InRange_IsAccepted(double jitter)
    {
        Assert.Equal(jitter, new BackoffOptions { Jitter = jitter }.Jitter);
    }
}
