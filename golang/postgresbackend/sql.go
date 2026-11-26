package postgresbackend

import (
	"embed"
	"fmt"
	"io/fs"
	"path"
	"sort"
	"strconv"
	"strings"
	"sync"
)

// sqlFS holds the shared PostgreSQL migrations and commands.
//
// The files are copied from src/postgres in the repository root with
// `yarn copy:sql:golang`; they are intentionally not committed so that every
// port runs the same single source of truth. Each command is one
// parameterized statement with no schema reference: the connection's
// search_path selects the schema.
//
//go:embed sql/commands/*.sql sql/migrations/*.sql
var sqlFS embed.FS

// migration is one bundled schema migration.
type migration struct {
	version int
	// name is the file name without its extension, as every runtime records
	// it in the ledger.
	name string
	sql  string
}

var (
	sqlOnce    sync.Once
	commands   map[string]string
	migrations []migration
	sqlErr     error
)

func loadSQL() error {
	sqlOnce.Do(func() {
		commands, sqlErr = readDir("sql/commands")
		if sqlErr != nil {
			return
		}
		var files map[string]string
		files, sqlErr = readDir("sql/migrations")
		if sqlErr != nil {
			return
		}
		for name, body := range files {
			prefix, _, _ := strings.Cut(name, "_")
			version, err := strconv.Atoi(prefix)
			if err != nil {
				sqlErr = fmt.Errorf("bullmq: migration %q has no numeric version prefix", name)
				return
			}
			migrations = append(migrations, migration{version: version, name: name, sql: body})
		}
		sort.Slice(migrations, func(i, j int) bool { return migrations[i].version < migrations[j].version })
		if len(commands) == 0 || len(migrations) == 0 {
			sqlErr = fmt.Errorf("bullmq: the PostgreSQL SQL files are missing; run `yarn copy:sql:golang`")
		}
	})
	return sqlErr
}

func readDir(dir string) (map[string]string, error) {
	entries, err := fs.ReadDir(sqlFS, dir)
	if err != nil {
		return nil, fmt.Errorf("bullmq: unable to read the embedded %s: %w", dir, err)
	}
	out := make(map[string]string, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		body, err := sqlFS.ReadFile(path.Join(dir, entry.Name()))
		if err != nil {
			return nil, err
		}
		out[strings.TrimSuffix(entry.Name(), ".sql")] = string(body)
	}
	return out, nil
}

// command returns the SQL of a shared command.
func command(name string) (string, error) {
	if err := loadSQL(); err != nil {
		return "", err
	}
	sql, ok := commands[name]
	if !ok {
		return "", fmt.Errorf("bullmq: the PostgreSQL command %q is not embedded; run `yarn copy:sql:golang`", name)
	}
	return sql, nil
}

// bundledMigrations returns the bundled migrations ordered by version.
func bundledMigrations() ([]migration, error) {
	if err := loadSQL(); err != nil {
		return nil, err
	}
	return migrations, nil
}
