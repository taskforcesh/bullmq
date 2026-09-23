using BullMQ;
using Xunit;

namespace BullMQ.Tests;

public class QueueKeysTests
{
    [Fact]
    public void BuildsQualifiedName()
    {
        var keys = new QueueKeys("bull");
        Assert.Equal("bull:myqueue", keys.GetQueueQualifiedName("myqueue"));
    }

    [Fact]
    public void BuildsNamespacedSubKey()
    {
        var keys = new QueueKeys("bull");
        Assert.Equal("bull:myqueue:wait", keys.ToKey("myqueue", "wait"));
    }

    [Fact]
    public void EmptyKeyIsTheBaseKey()
    {
        var keys = new QueueKeys("bull").GetKeys("myqueue");
        Assert.Equal("bull:myqueue:", keys[""]);
        Assert.Equal("bull:myqueue:wait", keys["wait"]);
        Assert.Equal("bull:myqueue:meta", keys["meta"]);
        Assert.Equal("bull:myqueue:marker", keys["marker"]);
    }

    [Fact]
    public void HonoursCustomPrefix()
    {
        var keys = new QueueKeys("custom").GetKeys("q");
        Assert.Equal("custom:q:active", keys["active"]);
    }
}
