using System.Text.Json;
using BullMQ.Serialization;
using Xunit;

namespace BullMQ.Tests;

public class DeduplicationOptionsTests
{
    [Theory]
    [InlineData("de")]
    [InlineData("deduplication")]
    public void ParsesCrossRuntimeOptions(string key)
    {
        var raw = new JobJson
        {
            Opts = $"{{\"{key}\":{{\"id\":\"shared\",\"ttl\":5000,\"extend\":false,\"replace\":false,\"reschedule\":true,\"keepLastIfActive\":false}}}}",
        };
        var job = Job.FromJson(null!, "queue", raw, "job");
        Assert.Equal("shared", job.DeduplicationId);
        var dedup = job.Opts.Deduplication!;
        Assert.Equal(5000, dedup.Ttl);
        Assert.False(dedup.Extend);
        Assert.False(dedup.Replace);
        Assert.True(dedup.Reschedule);
        Assert.False(dedup.KeepLastIfActive);
        var storage = OptsCodec.ToStorageMap(job.Opts);
        using var doc = JsonDocument.Parse(OptsCodec.ToJson(job.Opts));
        Assert.False(doc.RootElement.GetProperty("deduplication").GetProperty("extend").GetBoolean());
        Assert.Equal(MsgPack.Encode(OptsCodec.Encode(storage)), job.PackedOpts());
    }

    [Fact]
    public void PreservesRawIdentityAndOmitsAbsentOptions()
    {
        var raw = JobJson.FromMap(new Dictionary<string, string?> { ["deid"] = "raw" });
        Assert.Equal("raw", Job.FromJson(null!, "queue", raw).DeduplicationId);
        Assert.DoesNotContain("deduplication", OptsCodec.ToJson(new JobsOptions()));
    }

    [Theory]
    [InlineData("{\"de\":{\"id\":null}}", typeof(JsonException))]
    [InlineData("{\"de\":{\"id\":\"x\",\"extend\":\"true\"}}", typeof(InvalidOperationException))]
    public void InvalidRecognizedOptionsRaiseErrors(string opts, Type exceptionType)
    {
        Assert.Throws(exceptionType, () => Job.FromJson(null!, "queue", new JobJson { Opts = opts }));
    }
}
