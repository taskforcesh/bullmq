package bullmq_test

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"regexp"
	"testing"

	bullmq "github.com/taskforcesh/bullmq-go"
)

// The release process sets Version (see scripts/publishGolang.sh and the
// prepareCmd of golang/package.json) together with the changelog, so the
// latest version in the changelog is Version: in this repository, where the
// release PR updates both, and in the published module.
func TestVersionMatchesTheChangelog(t *testing.T) {
	if !regexp.MustCompile(`^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$`).MatchString(bullmq.Version) {
		t.Fatalf("Version %q is not a SemVer version", bullmq.Version)
	}
	var changelog []byte
	for _, path := range []string{"../docs/gitbook/golang/changelog.md", "CHANGELOG.md"} {
		b, err := os.ReadFile(path)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			t.Fatal(err)
		}
		changelog = b
		break
	}
	if changelog == nil {
		t.Skip("no changelog found")
	}
	// semantic-release writes `# [1.2.0](compare-url) (date)`, `## [1.2.1](...)`
	// or `# 1.0.0 (date)`; publishGolang.sh may add `## 1.2.0`.
	m := regexp.MustCompile(`(?m)^#{1,3} \[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)`).FindSubmatch(changelog)
	if m == nil {
		if bullmq.Version != "0.0.0-dev" {
			t.Fatalf("Version = %q, but the changelog lists no release; want 0.0.0-dev", bullmq.Version)
		}
		return
	}
	if latest := string(m[1]); bullmq.Version != latest {
		t.Fatalf("Version = %q, but the latest release in the changelog is %q", bullmq.Version, latest)
	}
}

// ScriptsVersion is generated from the root package.json, whose scripts the
// module embeds, by `yarn copy:lua:golang` and `yarn copy:sql:golang`.
func TestScriptsVersionMatchesThePackageJSON(t *testing.T) {
	if !regexp.MustCompile(`^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$`).MatchString(bullmq.ScriptsVersion) {
		t.Fatalf("ScriptsVersion %q is not a SemVer version", bullmq.ScriptsVersion)
	}
	b, err := os.ReadFile("../package.json")
	if errors.Is(err, fs.ErrNotExist) {
		t.Skip("no root package.json: this is the published module")
	}
	if err != nil {
		t.Fatal(err)
	}
	var pkg struct{ Name, Version string }
	if err := json.Unmarshal(b, &pkg); err != nil {
		t.Fatal(err)
	}
	if pkg.Name != "bullmq" {
		t.Skipf("../package.json is %q, not bullmq", pkg.Name)
	}
	if bullmq.ScriptsVersion != pkg.Version {
		t.Fatalf("ScriptsVersion = %q, but the root package.json is %q: run `yarn copy:lua:golang`", bullmq.ScriptsVersion, pkg.Version)
	}
}
