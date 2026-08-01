using System.Buffers.Binary;
using System.Text;

namespace BullMQ.Serialization;

/// <summary>
/// Minimal, dependency-free MessagePack encoder used to build the <c>ARGV</c>
/// payloads consumed by the shared Lua scripts (which decode them with
/// <c>cmsgpack.unpack</c>).
///
/// Only the value shapes actually used by BullMQ are supported: <c>null</c>,
/// booleans, integers, floating point numbers, strings, raw byte buffers,
/// arrays and string-keyed maps. The encoder emits canonical (most-compact)
/// MessagePack, which <c>cmsgpack</c> decodes identically to the reference
/// runtimes.
/// </summary>
public static class MsgPack
{
    /// <summary>Encodes an arbitrary supported value graph into MessagePack bytes.</summary>
    public static byte[] Encode(object? value)
    {
        var buffer = new List<byte>(64);
        WriteValue(buffer, value);
        return buffer.ToArray();
    }

    private static void WriteValue(List<byte> buffer, object? value)
    {
        switch (value)
        {
            case null:
                buffer.Add(0xc0);
                break;
            case bool b:
                buffer.Add(b ? (byte)0xc3 : (byte)0xc2);
                break;
            case string s:
                WriteString(buffer, s);
                break;
            case byte[] bytes:
                WriteBinary(buffer, bytes);
                break;
            case sbyte or byte or short or ushort or int or uint or long:
                WriteInt(buffer, Convert.ToInt64(value));
                break;
            case ulong ul:
                WriteUInt(buffer, ul);
                break;
            case float f:
                WriteDouble(buffer, f);
                break;
            case double d:
                WriteDouble(buffer, d);
                break;
            case System.Collections.IDictionary map:
                WriteMap(buffer, map);
                break;
            case System.Collections.IEnumerable seq:
                WriteArray(buffer, seq);
                break;
            default:
                throw new NotSupportedException(
                    $"MsgPack.Encode does not support values of type {value.GetType()}");
        }
    }

    private static void WriteInt(List<byte> buffer, long value)
    {
        if (value >= 0)
        {
            WriteUInt(buffer, (ulong)value);
            return;
        }

        if (value >= -32)
        {
            buffer.Add((byte)value); // negative fixint
        }
        else if (value >= sbyte.MinValue)
        {
            buffer.Add(0xd0);
            buffer.Add((byte)value);
        }
        else if (value >= short.MinValue)
        {
            buffer.Add(0xd1);
            WriteBigEndian(buffer, (short)value);
        }
        else if (value >= int.MinValue)
        {
            buffer.Add(0xd2);
            WriteBigEndian(buffer, (int)value);
        }
        else
        {
            buffer.Add(0xd3);
            WriteBigEndian(buffer, value);
        }
    }

    private static void WriteUInt(List<byte> buffer, ulong value)
    {
        if (value < 0x80)
        {
            buffer.Add((byte)value); // positive fixint
        }
        else if (value <= byte.MaxValue)
        {
            buffer.Add(0xcc);
            buffer.Add((byte)value);
        }
        else if (value <= ushort.MaxValue)
        {
            buffer.Add(0xcd);
            WriteBigEndian(buffer, (ushort)value);
        }
        else if (value <= uint.MaxValue)
        {
            buffer.Add(0xce);
            WriteBigEndian(buffer, (uint)value);
        }
        else
        {
            buffer.Add(0xcf);
            WriteBigEndian(buffer, value);
        }
    }

    private static void WriteDouble(List<byte> buffer, double value)
    {
        buffer.Add(0xcb);
        Span<byte> tmp = stackalloc byte[8];
        BinaryPrimitives.WriteDoubleBigEndian(tmp, value);
        for (var i = 0; i < tmp.Length; i++)
        {
            buffer.Add(tmp[i]);
        }
    }

    private static void WriteString(List<byte> buffer, string value)
    {
        var bytes = Encoding.UTF8.GetBytes(value);
        var len = bytes.Length;

        if (len < 32)
        {
            buffer.Add((byte)(0xa0 | len)); // fixstr
        }
        else if (len <= byte.MaxValue)
        {
            buffer.Add(0xd9);
            buffer.Add((byte)len);
        }
        else if (len <= ushort.MaxValue)
        {
            buffer.Add(0xda);
            WriteBigEndian(buffer, (ushort)len);
        }
        else
        {
            buffer.Add(0xdb);
            WriteBigEndian(buffer, (uint)len);
        }

        buffer.AddRange(bytes);
    }

    private static void WriteBinary(List<byte> buffer, byte[] value)
    {
        var len = value.Length;
        if (len <= byte.MaxValue)
        {
            buffer.Add(0xc4);
            buffer.Add((byte)len);
        }
        else if (len <= ushort.MaxValue)
        {
            buffer.Add(0xc5);
            WriteBigEndian(buffer, (ushort)len);
        }
        else
        {
            buffer.Add(0xc6);
            WriteBigEndian(buffer, (uint)len);
        }

        buffer.AddRange(value);
    }

    private static void WriteArray(List<byte> buffer, System.Collections.IEnumerable seq)
    {
        var items = new List<object?>();
        foreach (var item in seq)
        {
            items.Add(item);
        }

        WriteArrayHeader(buffer, items.Count);
        foreach (var item in items)
        {
            WriteValue(buffer, item);
        }
    }

    private static void WriteArrayHeader(List<byte> buffer, int count)
    {
        if (count < 16)
        {
            buffer.Add((byte)(0x90 | count)); // fixarray
        }
        else if (count <= ushort.MaxValue)
        {
            buffer.Add(0xdc);
            WriteBigEndian(buffer, (ushort)count);
        }
        else
        {
            buffer.Add(0xdd);
            WriteBigEndian(buffer, (uint)count);
        }
    }

    private static void WriteMap(List<byte> buffer, System.Collections.IDictionary map)
    {
        var count = map.Count;
        if (count < 16)
        {
            buffer.Add((byte)(0x80 | count)); // fixmap
        }
        else if (count <= ushort.MaxValue)
        {
            buffer.Add(0xde);
            WriteBigEndian(buffer, (ushort)count);
        }
        else
        {
            buffer.Add(0xdf);
            WriteBigEndian(buffer, (uint)count);
        }

        foreach (System.Collections.DictionaryEntry entry in map)
        {
            WriteValue(buffer, entry.Key?.ToString());
            WriteValue(buffer, entry.Value);
        }
    }

    private static void WriteBigEndian(List<byte> buffer, short value) =>
        WriteBigEndian(buffer, (ushort)value);

    private static void WriteBigEndian(List<byte> buffer, ushort value)
    {
        buffer.Add((byte)(value >> 8));
        buffer.Add((byte)value);
    }

    private static void WriteBigEndian(List<byte> buffer, int value) =>
        WriteBigEndian(buffer, (uint)value);

    private static void WriteBigEndian(List<byte> buffer, uint value)
    {
        buffer.Add((byte)(value >> 24));
        buffer.Add((byte)(value >> 16));
        buffer.Add((byte)(value >> 8));
        buffer.Add((byte)value);
    }

    private static void WriteBigEndian(List<byte> buffer, long value) =>
        WriteBigEndian(buffer, (ulong)value);

    private static void WriteBigEndian(List<byte> buffer, ulong value)
    {
        for (var shift = 56; shift >= 0; shift -= 8)
        {
            buffer.Add((byte)(value >> shift));
        }
    }
}
