using System.Reflection;

namespace BullMQ.Redis;

/// <summary>
/// A single shared Lua command, loaded from an embedded <c>*.lua</c> resource.
/// The number of <c>KEYS</c> is encoded in the file name as
/// <c>&lt;name&gt;-&lt;numKeys&gt;.lua</c>.
/// </summary>
public sealed record LuaScript(string Name, int NumberOfKeys, string Content);

/// <summary>
/// Loads and caches the shared, pre-flattened Lua command scripts that are
/// embedded into the assembly (copied from the repository's <c>rawScripts/</c>
/// folder at build time). These scripts are the single source of truth shared
/// with every other BullMQ runtime and are never modified here.
/// </summary>
public static class LuaScripts
{
    private static readonly Lazy<IReadOnlyDictionary<string, LuaScript>> Cache =
        new(LoadAll);

    /// <summary>All loaded scripts keyed by command name (without the key suffix).</summary>
    public static IReadOnlyDictionary<string, LuaScript> All => Cache.Value;

    /// <summary>Gets a script by command name, throwing if it is not embedded.</summary>
    public static LuaScript Get(string name)
    {
        if (!Cache.Value.TryGetValue(name, out var script))
        {
            throw new InvalidOperationException(
                $"Lua command '{name}' was not found among the embedded scripts. " +
                "Ensure the scripts were copied via 'copy:lua:dotnet'.");
        }

        return script;
    }

    private static IReadOnlyDictionary<string, LuaScript> LoadAll()
    {
        var assembly = typeof(LuaScripts).Assembly;
        var result = new Dictionary<string, LuaScript>(StringComparer.Ordinal);

        foreach (var resourceName in assembly.GetManifestResourceNames())
        {
            if (!resourceName.EndsWith(".lua", StringComparison.Ordinal))
            {
                continue;
            }

            // Resource names look like "BullMQ.Commands.addStandardJob-9.lua".
            // Take the final "<name>-<numKeys>.lua" segment.
            var fileName = ExtractFileName(resourceName);
            var withoutExt = fileName[..^".lua".Length];

            var dashIndex = withoutExt.LastIndexOf('-');
            if (dashIndex < 0 ||
                !int.TryParse(withoutExt[(dashIndex + 1)..], out var numberOfKeys))
            {
                continue;
            }

            var name = withoutExt[..dashIndex];
            var content = ReadResource(assembly, resourceName);
            result[name] = new LuaScript(name, numberOfKeys, content);
        }

        return result;
    }

    private static string ExtractFileName(string resourceName)
    {
        // The file name is the part after the last '.' that precedes ".lua",
        // i.e. everything after the folder-derived namespace prefix. Since the
        // extension itself contains a '.', strip it first, split on '.', then
        // re-append.
        var withoutExt = resourceName[..^".lua".Length];
        var lastDot = withoutExt.LastIndexOf('.');
        var stem = lastDot >= 0 ? withoutExt[(lastDot + 1)..] : withoutExt;
        return stem + ".lua";
    }

    private static string ReadResource(Assembly assembly, string resourceName)
    {
        using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"Missing embedded resource {resourceName}");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
