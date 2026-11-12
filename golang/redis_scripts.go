package bullmq

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"path"
	"strconv"
	"strings"
	"sync"

	"github.com/redis/go-redis/v9"
)

// commandsFS holds the shared BullMQ Lua commands.
//
// The files are generated from the repository root with
// `yarn generate:raw:scripts && yarn copy:lua:golang`; they are intentionally
// not committed so that every port consumes the same single source of truth.
//
//go:embed commands/*.lua
var commandsFS embed.FS

// luaScript is a single Lua command together with its declared key count.
type luaScript struct {
	name    string
	numKeys int
	script  *redis.Script
}

var (
	scriptsOnce sync.Once
	scripts     map[string]*luaScript
	scriptsErr  error
)

// loadScripts parses the embedded `<name>-<numKeys>.lua` files once.
func loadScripts() (map[string]*luaScript, error) {
	scriptsOnce.Do(func() {
		entries, err := fs.ReadDir(commandsFS, "commands")
		if err != nil {
			scriptsErr = fmt.Errorf("bullmq: unable to read embedded commands: %w", err)
			return
		}
		loaded := make(map[string]*luaScript, len(entries))
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".lua") {
				continue
			}
			base := strings.TrimSuffix(entry.Name(), ".lua")
			idx := strings.LastIndex(base, "-")
			if idx < 0 {
				continue
			}
			numKeys, err := strconv.Atoi(base[idx+1:])
			if err != nil {
				continue
			}
			body, err := commandsFS.ReadFile(path.Join("commands", entry.Name()))
			if err != nil {
				scriptsErr = fmt.Errorf("bullmq: unable to read %s: %w", entry.Name(), err)
				return
			}
			name := base[:idx]
			if previous, dup := loaded[name]; dup {
				scriptsErr = fmt.Errorf(
					"bullmq: command %q is embedded twice (%d and %d keys); "+
						"delete the stale file and re-run `yarn generate:raw:scripts && yarn copy:lua:golang`",
					name, previous.numKeys, numKeys)
				return
			}
			loaded[name] = &luaScript{
				name:    name,
				numKeys: numKeys,
				script:  redis.NewScript(string(body)),
			}
		}
		if len(loaded) == 0 {
			scriptsErr = fmt.Errorf("bullmq: no Lua commands were embedded; " +
				"run `yarn generate:raw:scripts && yarn copy:lua:golang` from the repository root")
			return
		}
		scripts = loaded
	})
	return scripts, scriptsErr
}

// getScript looks a command up by name.
func getScript(name string) (*luaScript, error) {
	all, err := loadScripts()
	if err != nil {
		return nil, err
	}
	s, ok := all[name]
	if !ok {
		return nil, fmt.Errorf("bullmq: unknown Lua command %q", name)
	}
	return s, nil
}

// run evaluates the command, transparently falling back from EVALSHA to EVAL.
func (s *luaScript) run(ctx context.Context, rdb redis.Scripter, keys []string, args ...any) *redis.Cmd {
	if len(keys) != s.numKeys {
		return redis.NewCmdResult(nil, fmt.Errorf(
			"bullmq: command %q expects %d keys, got %d", s.name, s.numKeys, len(keys)))
	}
	return s.script.Run(ctx, rdb, keys, args...)
}
