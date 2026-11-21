package postgresbackend

import (
	"strings"
)

// PostgreSQL keeps only printable ASCII in an application_name: from
// version 16 it replaces every other byte with a `\xhh` escape, before that
// with `?`. It then truncates the name to 63 bytes.

// isPrintableASCII reports whether PostgreSQL keeps byte c of an
// application_name as it is.
func isPrintableASCII(c byte) bool { return c >= 32 && c <= 126 }

// escapeAppName returns name as PostgreSQL 16+ stores it as an
// application_name, before truncation.
func escapeAppName(name string) string {
	var sb strings.Builder
	for i := 0; i < len(name); i++ {
		c := name[i]
		if isPrintableASCII(c) {
			sb.WriteByte(c)
			continue
		}
		const hex = "0123456789abcdef"
		sb.WriteString(`\x`)
		sb.WriteByte(hex[c>>4])
		sb.WriteByte(hex[c&0xf])
	}
	return sb.String()
}

// legacyAppName returns name as PostgreSQL 13-15 store it as an
// application_name, before truncation.
func legacyAppName(name string) string {
	b := []byte(name)
	for i, c := range b {
		if !isPrintableASCII(c) {
			b[i] = '?'
		}
	}
	return string(b)
}

// unescapeAppName reverses escapeAppName for non-ASCII bytes, the UTF-8 of
// a name. Other escapes, of control characters that would break the
// `CLIENT LIST` format or cut short by the truncation, are kept as they are.
func unescapeAppName(s string) string {
	if !strings.Contains(s, `\x`) {
		return s
	}
	var sb strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+3 < len(s) && s[i+1] == 'x' {
			hi, okHi := lowerHexDigit(s[i+2])
			lo, okLo := lowerHexDigit(s[i+3])
			if c := hi<<4 | lo; okHi && okLo && c >= 0x80 {
				sb.WriteByte(c)
				i += 3
				continue
			}
		}
		sb.WriteByte(s[i])
	}
	return sb.String()
}

func lowerHexDigit(c byte) (byte, bool) {
	switch {
	case c >= '0' && c <= '9':
		return c - '0', true
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10, true
	default:
		return 0, false
	}
}

// clientNameAsSet maps the application_name of a connection of this queue
// (`{queue}`, `{queue}:w:{name}`, `{queue}:qe`, named by a Go or a Node.js
// client) back to the name its client set, undoing PostgreSQL's escaping,
// so worker discovery matches it against ClientName. A name PostgreSQL 13-15
// stored with `?` gets the queue name back, but the rest keeps its `?`. Other
// names are returned as they are.
func (b *Backend) clientNameAsSet(appName string) string {
	if b.serverMajor >= 16 {
		if rest, ok := strings.CutPrefix(appName, escapeAppName(b.name)); ok {
			return b.name + unescapeAppName(rest)
		}
	} else {
		if rest, ok := strings.CutPrefix(appName, legacyAppName(b.name)); ok {
			return b.name + rest
		}
	}
	return appName
}
