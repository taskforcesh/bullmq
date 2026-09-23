using BullMQ.Serialization;
using Xunit;

namespace BullMQ.Tests;

public class MsgPackTests
{
    [Fact]
    public void EncodesNil() => Assert.Equal(new byte[] { 0xc0 }, MsgPack.Encode(null));

    [Fact]
    public void EncodesBooleans()
    {
        Assert.Equal(new byte[] { 0xc3 }, MsgPack.Encode(true));
        Assert.Equal(new byte[] { 0xc2 }, MsgPack.Encode(false));
    }

    [Theory]
    [InlineData(0, new byte[] { 0x00 })]
    [InlineData(127, new byte[] { 0x7f })]
    [InlineData(-1, new byte[] { 0xff })]
    [InlineData(-32, new byte[] { 0xe0 })]
    public void EncodesSmallInts(int value, byte[] expected) =>
        Assert.Equal(expected, MsgPack.Encode(value));

    [Fact]
    public void EncodesUint8() => Assert.Equal(new byte[] { 0xcc, 0xc8 }, MsgPack.Encode(200));

    [Fact]
    public void EncodesUint16() => Assert.Equal(new byte[] { 0xcd, 0x01, 0x00 }, MsgPack.Encode(256));

    [Fact]
    public void EncodesInt64Timestamp()
    {
        // 1_700_000_000_000 -> uint40 fits in uint64 path (0xcf).
        var bytes = MsgPack.Encode(1_700_000_000_000L);
        Assert.Equal(0xcf, bytes[0]);
        Assert.Equal(9, bytes.Length);
    }

    [Fact]
    public void EncodesFixStr()
    {
        Assert.Equal(new byte[] { 0xa2, (byte)'h', (byte)'i' }, MsgPack.Encode("hi"));
        Assert.Equal(new byte[] { 0xa0 }, MsgPack.Encode(string.Empty));
    }

    [Fact]
    public void EncodesFixArray()
    {
        Assert.Equal(new byte[] { 0x92, 0x01, 0x02 }, MsgPack.Encode(new object[] { 1, 2 }));
    }

    [Fact]
    public void EncodesFixMap()
    {
        var map = new Dictionary<string, object?> { ["a"] = 1 };
        Assert.Equal(new byte[] { 0x81, 0xa1, (byte)'a', 0x01 }, MsgPack.Encode(map));
    }

    [Fact]
    public void EncodesBinary()
    {
        Assert.Equal(new byte[] { 0xc4, 0x02, 0xaa, 0xbb }, MsgPack.Encode(new byte[] { 0xaa, 0xbb }));
    }

    [Fact]
    public void EncodesNestedAddJobArgsShape()
    {
        // Mirrors the 9-element addJob args array with a nil parent.
        var value = new object?[]
        {
            "bull:q:", "1", "myjob", 1700000000000L, null, null, null, null, null,
        };

        var bytes = MsgPack.Encode(value);
        Assert.Equal(0x99, bytes[0]); // fixarray of 9 elements
    }
}
