// Package lua resolves the `--- @include "<path>"` directives used by the
// shared BullMQ Lua commands.
//
// It is the Go counterpart of src/commands/script-loader.ts: the committed Lua
// files under golang/commands are the canonical sources shared by every port,
// and the fully interpolated scripts are produced in memory the first time they
// are needed. The resolved output is byte for byte identical to the one
// `yarn generate:raw:scripts` writes to rawScripts/<name>-<numKeys>.lua.
package lua

import (
	"crypto/sha1"
	"encoding/hex"
	"fmt"
	"io/fs"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// includeRegex mirrors IncludeRegex from src/commands/script-loader.ts. RE2 has
// no backreferences, so both quote styles are spelled out as alternatives.
var includeRegex = regexp.MustCompile(
	`(?m)^[-]{2,3}[ \t]*@include[ \t]+(?:"(.+?)"|'(.+?)')[; \t\r\n]*$`)

// emptyLineRegex mirrors EmptyLineRegex from src/commands/script-loader.ts.
var emptyLineRegex = regexp.MustCompile(`(?m)^[\t\f ]*[\r\n]`)

// Script is a command whose includes have been fully interpolated.
type Script struct {
	// Name is the camel case command name, e.g. "moveToFinished".
	Name string
	// NumKeys is the number of keys declared by the `-<n>.lua` suffix.
	NumKeys int
	// Source is the Lua body, ready to be sent to Redis.
	Source string
}

// metadata is the parsed representation of a single Lua file.
type metadata struct {
	path     string
	content  string
	token    string
	includes []*metadata
}

// LoadScripts resolves every `<name>-<numKeys>.lua` file found in dir.
//
// Includes are looked up relative to the file that references them, so dir must
// also contain the files they point at (typically dir/includes).
func LoadScripts(fsys fs.FS, dir string) (map[string]Script, error) {
	entries, err := fs.ReadDir(fsys, dir)
	if err != nil {
		return nil, fmt.Errorf("unable to read %s: %w", dir, err)
	}

	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".lua") {
			continue
		}
		names = append(names, entry.Name())
	}
	if len(names) == 0 {
		return nil, fmt.Errorf("no .lua files found in %s", dir)
	}
	sort.Strings(names)

	cache := map[string]*metadata{}
	scripts := make(map[string]Script, len(names))
	for _, filename := range names {
		name, numKeys, ok := splitFilename(filename)
		if !ok {
			return nil, fmt.Errorf(
				"%s: expected a <name>-<numKeys>.lua filename", path.Join(dir, filename))
		}
		if previous, duplicate := scripts[name]; duplicate {
			return nil, fmt.Errorf(
				"command %q is declared twice (%d and %d keys)", name, previous.NumKeys, numKeys)
		}

		source, err := resolve(fsys, path.Join(dir, filename), cache)
		if err != nil {
			return nil, err
		}
		scripts[name] = Script{Name: name, NumKeys: numKeys, Source: source}
	}
	return scripts, nil
}

// resolve reads a top level command and returns its interpolated content.
func resolve(fsys fs.FS, filePath string, cache map[string]*metadata) (string, error) {
	content, err := fs.ReadFile(fsys, filePath)
	if err != nil {
		return "", fmt.Errorf("unable to read %s: %w", filePath, err)
	}

	root := &metadata{
		path:    filePath,
		content: string(content),
		token:   pathHash(filePath),
	}
	if err := resolveDependencies(fsys, root, cache, nil); err != nil {
		return "", err
	}
	return removeEmptyLines(interpolate(root, map[string]bool{})), nil
}

// resolveDependencies swaps every @include directive for the hash token of the
// referenced file, loading that file recursively.
func resolveDependencies(
	fsys fs.FS, file *metadata, cache map[string]*metadata, stack []string,
) error {
	for _, entry := range stack {
		if entry == file.path {
			return fmt.Errorf("%s: circular reference", file.path)
		}
	}
	stack = append(stack, file.path)

	content := file.content
	for {
		match := includeRegex.FindStringSubmatch(content)
		if match == nil {
			break
		}
		reference := match[1]
		if reference == "" {
			reference = match[2]
		}

		includePath, err := resolveIncludePath(file.path, reference)
		if err != nil {
			return err
		}

		for _, included := range file.includes {
			if included.path == includePath {
				return fmt.Errorf("%s: file %q is included twice", file.path, reference)
			}
		}

		included, cached := cache[includePath]
		if !cached {
			body, err := fs.ReadFile(fsys, includePath)
			if err != nil {
				return fmt.Errorf("%s: include %q not found: %w", file.path, reference, err)
			}
			included = &metadata{
				path:    includePath,
				content: string(body),
				token:   pathHash(includePath),
			}
			cache[includePath] = included
			if err := resolveDependencies(fsys, included, cache, stack); err != nil {
				return err
			}
		}

		file.includes = append(file.includes, included)
		content = strings.Replace(content, match[0], included.token, 1)
	}
	file.content = content

	if leftover := includeRegex.FindString(file.content); leftover != "" {
		return fmt.Errorf("%s: unresolved include %q", file.path, leftover)
	}
	return nil
}

// resolveIncludePath turns an @include reference into a path inside fsys.
//
// BullMQ's shared commands only use includes relative to the referencing file;
// the path mappings and glob patterns the TypeScript loader supports are
// rejected explicitly so a new one cannot be silently dropped.
func resolveIncludePath(parent, reference string) (string, error) {
	if reference == "" || reference[0] == '~' || reference[0] == '<' {
		return "", fmt.Errorf("%s: unsupported mapped include %q", parent, reference)
	}
	if strings.ContainsAny(reference, "*?[") {
		return "", fmt.Errorf("%s: unsupported glob include %q", parent, reference)
	}
	if path.Ext(reference) == "" {
		reference += ".lua"
	}
	resolved := path.Join(path.Dir(parent), reference)
	if strings.HasPrefix(resolved, "../") {
		return "", fmt.Errorf("%s: include %q escapes the commands directory", parent, reference)
	}
	return resolved, nil
}

// interpolate inlines every include in dependency order, emitting each one only
// once.
func interpolate(file *metadata, processed map[string]bool) string {
	content := file.content
	for _, include := range file.includes {
		emitted := processed[include.path]
		fragment := interpolate(include, processed)

		if emitted || fragment == "" {
			content = strings.ReplaceAll(content, include.token, "")
		} else {
			content = strings.Replace(content, include.token, fragment, 1)
			content = strings.ReplaceAll(content, include.token, "")
		}
		processed[include.path] = true
	}
	return content
}

// splitFilename extracts the command name and key count from `<name>-<n>.lua`.
func splitFilename(filename string) (name string, numKeys int, ok bool) {
	base := strings.TrimSuffix(path.Base(filename), ".lua")
	idx := strings.Index(base, "-")
	if idx < 0 {
		return base, 0, false
	}
	numKeys, err := strconv.Atoi(base[idx+1:])
	if err != nil {
		return base[:idx], 0, false
	}
	return base[:idx], numKeys, true
}

func pathHash(normalizedPath string) string {
	sum := sha1.Sum([]byte(normalizedPath))
	return "@@" + hex.EncodeToString(sum[:])
}

func removeEmptyLines(str string) string {
	return emptyLineRegex.ReplaceAllString(str, "")
}
