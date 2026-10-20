package bullmq

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/taskforcesh/bullmq/golang/internal/lua"
)

// TestLoadScriptsResolvesEveryCommand makes sure the embedded sources are
// complete: a missing include or a stale `-<numKeys>` suffix fails here instead
// of on the first Redis round trip.
func TestLoadScriptsResolvesEveryCommand(t *testing.T) {
	all, err := loadScripts()
	if err != nil {
		t.Fatalf("loadScripts: %v", err)
	}
	if len(all) == 0 {
		t.Fatal("no Lua commands were loaded")
	}

	entries, err := commandsFS.ReadDir("commands")
	if err != nil {
		t.Fatalf("read embedded commands: %v", err)
	}
	embedded := 0
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".lua") {
			embedded++
		}
	}
	if len(all) != embedded {
		t.Fatalf("resolved %d commands, embedded %d", len(all), embedded)
	}
}

// TestResolvedScriptsMatchRawScripts pins the Go include resolver to the
// reference TypeScript one. It only runs inside the monorepo, where
// `yarn generate:raw:scripts` has produced rawScripts/.
func TestResolvedScriptsMatchRawScripts(t *testing.T) {
	rawDir := filepath.Join("..", "rawScripts")
	if _, err := os.Stat(rawDir); err != nil {
		t.Skip("rawScripts not generated; run `yarn generate:raw:scripts` from the repository root")
	}

	resolved, err := lua.LoadScripts(commandsFS, "commands")
	if err != nil {
		t.Fatalf("LoadScripts: %v", err)
	}

	for name, script := range resolved {
		filename := fmt.Sprintf("%s-%d.lua", name, script.NumKeys)
		expected, err := os.ReadFile(filepath.Join(rawDir, filename))
		if err != nil {
			t.Errorf("%s: %v", name, err)
			continue
		}
		if string(expected) != script.Source {
			t.Errorf("%s: resolved script differs from rawScripts/%s", name, filename)
		}
	}
}
