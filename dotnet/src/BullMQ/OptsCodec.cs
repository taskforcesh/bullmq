using System.Text.Json;

namespace BullMQ;

/// <summary>
/// Encodes/decodes job option keys between their long (public) form and the
/// short form persisted in Redis, matching the reference runtimes. Only a small
/// set of keys are shortened; every other key is stored verbatim.
/// </summary>
internal static class OptsCodec
{
    // Short form -> long form (as stored in Redis -> public name).
    private static readonly Dictionary<string, string> DecodeMap = new(StringComparer.Ordinal)
    {
        ["fpof"] = "failParentOnFailure",
        ["cpof"] = "continueParentOnFailure",
        ["idof"] = "ignoreDependencyOnFailure",
        ["rdof"] = "removeDependencyOnFailure",
        ["kl"] = "keepLogs",
        ["de"] = "deduplication",
    };

    private static readonly Dictionary<string, string> EncodeMap =
        DecodeMap.ToDictionary(kv => kv.Value, kv => kv.Key, StringComparer.Ordinal);

    /// <summary>Applies short-form encoding to the keys of an options map.</summary>
    public static Dictionary<string, object?> Encode(IReadOnlyDictionary<string, object?> opts)
    {
        var encoded = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var (key, value) in opts)
        {
            encoded[EncodeMap.TryGetValue(key, out var shortKey) ? shortKey : key] = value;
        }

        return encoded;
    }

    /// <summary>
    /// Builds the storage options map (long form) from strongly-typed options.
    /// Only non-default values are included, matching how the reference runtimes
    /// persist a compact options object.
    /// </summary>
    public static Dictionary<string, object?> ToStorageMap(JobsOptions opts)
    {
        var map = new Dictionary<string, object?>(StringComparer.Ordinal)
        {
            ["attempts"] = opts.Attempts ?? 0,
            ["delay"] = opts.Delay ?? 0,
        };

        if (opts.Priority is { } priority && priority != 0)
        {
            map["priority"] = priority;
        }

        if (opts.Backoff is { } backoff)
        {
            map["backoff"] = new Dictionary<string, object?>(StringComparer.Ordinal)
            {
                ["type"] = backoff.Type,
                ["delay"] = backoff.Delay,
            };
        }

        if (opts.Lifo is { } lifo && lifo)
        {
            map["lifo"] = true;
        }

        if (opts.RemoveOnComplete is { } roc)
        {
            map["removeOnComplete"] = NormalizeRemove(roc);
        }

        if (opts.RemoveOnFail is { } rof)
        {
            map["removeOnFail"] = NormalizeRemove(rof);
        }

        if (opts.KeepLogs is { } keepLogs)
        {
            map["keepLogs"] = keepLogs;
        }

        return map;
    }

    private static object? NormalizeRemove(object value) => value switch
    {
        KeepJobs keep => KeepToMap(keep),
        _ => value,
    };

    private static Dictionary<string, object?> KeepToMap(KeepJobs keep)
    {
        var map = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (keep.Count is { } count)
        {
            map["count"] = count;
        }

        if (keep.Age is { } age)
        {
            map["age"] = age;
        }

        return map;
    }

    /// <summary>Serializes the storage options map to compact JSON.</summary>
    public static string ToJson(JobsOptions opts) =>
        JsonSerializer.Serialize(ToStorageMap(opts), JsonUtil.Compact);
}

/// <summary>Shared JSON serialization settings matching JS <c>JSON.stringify</c> (compact).</summary>
internal static class JsonUtil
{
    public static readonly JsonSerializerOptions Compact = new()
    {
        WriteIndented = false,
    };

    public static string Serialize(object? value) => JsonSerializer.Serialize(value, Compact);
}
