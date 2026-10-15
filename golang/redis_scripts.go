package bullmq

import (
	"context"
	"embed"
	"fmt"
	"sync"

	"github.com/redis/go-redis/v9"

	"github.com/taskforcesh/bullmq/golang/internal/lua"
)

// commandsFS holds the shared BullMQ Lua commands.
//
// This directory is the canonical home of the scripts used by every port: the
// Go module proxy serves whatever is committed under golang/ at a tag, and
// //go:embed cannot reach outside its module or run a generation step first.
// The sources keep their `--- @include` directives, which the internal/lua
// package interpolates at runtime to produce the same scripts as
// `yarn generate:raw:scripts`.
//
//go:embed commands/*.lua commands/includes/*.lua
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

// loadScripts resolves the embedded commands once, on first use.
func loadScripts() (map[string]*luaScript, error) {
	scriptsOnce.Do(func() {
		resolved, err := lua.LoadScripts(commandsFS, "commands")
		if err != nil {
			scriptsErr = fmt.Errorf("bullmq: unable to load Lua commands: %w", err)
			return
		}
		loaded := make(map[string]*luaScript, len(resolved))
		for name, command := range resolved {
			loaded[name] = &luaScript{
				name:    name,
				numKeys: command.NumKeys,
				script:  redis.NewScript(command.Source),
			}
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
