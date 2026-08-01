using System.Reflection;

namespace BullMQ.Postgres;

/// <summary>
/// Loads the shared PostgreSQL SQL (the single, portable source of truth) that
/// is embedded into the assembly from <c>src/postgres</c> at build time (copied
/// by <c>copy:sql:dotnet</c>, git-ignored like the Lua scripts).
///
/// Each command file is a single parameterized statement using native
/// <c>$1..$N</c> placeholders and contains no schema references — the
/// connection's <c>search_path</c> selects the schema — so the files stay
/// portable and injection-safe.
/// </summary>
public static class SqlLoader
{
    private const string CommandsPrefix = ".Postgres.commands.";
    private const string MigrationsPrefix = ".Postgres.migrations.";

    private static readonly Lazy<IReadOnlyDictionary<string, string>> Commands =
        new(() => Load(CommandsPrefix));

    private static readonly Lazy<IReadOnlyDictionary<string, string>> Migrations =
        new(() => Load(MigrationsPrefix));

    /// <summary>Loads a runtime command's SQL by name (without the <c>.sql</c> extension).</summary>
    public static string LoadCommand(string name)
    {
        if (!Commands.Value.TryGetValue(name, out var sql))
        {
            throw new InvalidOperationException(
                $"PostgreSQL command '{name}' was not found among the embedded scripts. " +
                "Ensure the scripts were copied via 'copy:sql:dotnet'.");
        }

        return sql;
    }

    /// <summary>Returns the migration file names (without extension) ordered by version.</summary>
    public static IReadOnlyList<string> MigrationFiles() =>
        Migrations.Value.Keys.OrderBy(NameToVersion).ToList();

    /// <summary>Loads a migration's SQL by file name (without the <c>.sql</c> extension).</summary>
    public static string LoadMigration(string file) => Migrations.Value[file];

    /// <summary>Parses the integer version prefix of a migration file name (<c>0001_schema</c> -&gt; 1).</summary>
    public static int NameToVersion(string file)
    {
        var underscore = file.IndexOf('_');
        var prefix = underscore >= 0 ? file[..underscore] : file;
        return int.TryParse(prefix, out var v) ? v : 0;
    }

    private static IReadOnlyDictionary<string, string> Load(string marker)
    {
        var assembly = typeof(SqlLoader).Assembly;
        var result = new Dictionary<string, string>(StringComparer.Ordinal);

        foreach (var resourceName in assembly.GetManifestResourceNames())
        {
            var idx = resourceName.IndexOf(marker, StringComparison.Ordinal);
            if (idx < 0 || !resourceName.EndsWith(".sql", StringComparison.Ordinal))
            {
                continue;
            }

            var name = resourceName[(idx + marker.Length)..^".sql".Length];
            result[name] = ReadResource(assembly, resourceName);
        }

        return result;
    }

    private static string ReadResource(Assembly assembly, string resourceName)
    {
        using var stream = assembly.GetManifestResourceStream(resourceName)
            ?? throw new InvalidOperationException($"Missing embedded resource {resourceName}");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
