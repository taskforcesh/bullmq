namespace BullMQ;

/// <summary>
/// Builds the fully-qualified Redis keys used by a queue.
///
/// Mirrors the reference Node.js <c>QueueKeys</c> class so that every runtime
/// addresses the exact same keys, which is what allows the shared Lua scripts to
/// operate identically regardless of the client language.
/// </summary>
public sealed class QueueKeys
{
    /// <summary>The key prefix (defaults to <c>"bull"</c>).</summary>
    public string Prefix { get; }

    public QueueKeys(string prefix = "bull")
    {
        Prefix = prefix;
    }

    /// <summary>
    /// The set of named sub-keys for a queue (e.g. <c>wait</c>, <c>active</c>,
    /// <c>delayed</c>, <c>meta</c>, <c>events</c>, ...). The empty key maps to the
    /// queue's base key (<c>"&lt;prefix&gt;:&lt;name&gt;:"</c>).
    /// </summary>
    public IReadOnlyDictionary<string, string> GetKeys(string name)
    {
        var keys = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var key in KeyTypes)
        {
            keys[key] = ToKey(name, key);
        }

        return keys;
    }

    /// <summary>Builds a single namespaced sub-key of the given <paramref name="type"/>.</summary>
    public string ToKey(string name, string type) => $"{GetQueueQualifiedName(name)}:{type}";

    /// <summary>The queue's fully-qualified name (<c>"&lt;prefix&gt;:&lt;name&gt;"</c>).</summary>
    public string GetQueueQualifiedName(string name) => $"{Prefix}:{name}";

    private static readonly string[] KeyTypes =
    {
        "",
        "active",
        "wait",
        "waiting-children",
        "paused",
        "id",
        "delayed",
        "prioritized",
        "stalled-check",
        "completed",
        "failed",
        "stalled",
        "repeat",
        "limiter",
        "meta",
        "events",
        "pc", // priority counter key
        "marker", // marker key
        "de", // deduplication key
    };
}
