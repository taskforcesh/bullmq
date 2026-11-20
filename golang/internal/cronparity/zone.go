package cronparity

import (
	_ "embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// zoneNames lists the IANA time zone names, canonical ones and links, of
// the tz database (Go's lib/time/zoneinfo.zip). It is only used to find the
// exact case of a name: the zones themselves are loaded with time.LoadLocation.
//
//go:embed zones.txt
var zoneNames string

// icuAliases are the legacy time zone ids ICU accepts, and therefore Node.js
// (Intl, through Luxon), that the tz database does not have, mapped to the
// zone ICU resolves them to (ICU 76).
var icuAliases = map[string]string{
	"act": "Australia/Darwin",
	"aet": "Australia/Sydney",
	"agt": "America/Buenos_Aires",
	"art": "Africa/Cairo",
	"ast": "America/Anchorage",
	"bet": "America/Sao_Paulo",
	"bst": "Asia/Dhaka",
	"cat": "Africa/Maputo",
	"cnt": "America/St_Johns",
	"cst": "America/Chicago",
	"ctt": "Asia/Shanghai",
	"eat": "Africa/Nairobi",
	"ect": "Europe/Paris",
	"iet": "America/Indianapolis",
	"ist": "Asia/Calcutta",
	"jst": "Asia/Tokyo",
	"mit": "Pacific/Apia",
	"net": "Asia/Yerevan",
	"nst": "Pacific/Auckland",
	"plt": "Asia/Karachi",
	"pnt": "America/Phoenix",
	"prt": "America/Puerto_Rico",
	"pst": "America/Los_Angeles",
	"sst": "Pacific/Guadalcanal",
	"vst": "Asia/Saigon",
}

var (
	// luxonOffsetRe is Luxon's FixedOffsetZone.parseSpecifier, on the
	// lowercased name: "utc", "utc+3", "utc-05:30".
	luxonOffsetRe = regexp.MustCompile(`^utc(?:([+-]\d{1,2})(?::(\d{2}))?)?$`)
	// intlOffsetRe is an offset time zone of Intl: ±HH, ±HHMM or ±HH:MM,
	// with "-" or U+2212 as the minus sign.
	intlOffsetRe = regexp.MustCompile(`^([+\-\x{2212}])(\d{2})(?::?(\d{2}))?$`)
	// ianaNameRe is the shape of a tz database name.
	ianaNameRe = regexp.MustCompile(`^[A-Za-z0-9_+\-]+(/[A-Za-z0-9_+\-]+)*$`)
)

// zoneSources are the directories Go reads zones from on Unix systems, after
// $ZONEINFO.
var zoneSources = []string{"/usr/share/zoneinfo", "/usr/share/lib/zoneinfo", "/usr/lib/locale/TZ", "/etc/zoneinfo"}

// zoneIndex maps lowercased zone names to their exact case. It indexes the
// embedded list and the zone files of the system, which may be newer.
var zoneIndex = sync.OnceValue(func() map[string]string {
	index := make(map[string]string, 700)
	add := func(name string) {
		if ianaNameRe.MatchString(name) {
			if _, ok := index[strings.ToLower(name)]; !ok {
				index[strings.ToLower(name)] = name
			}
		}
	}
	for _, name := range strings.Fields(zoneNames) {
		add(name)
	}
	dirs := zoneSources
	if dir := os.Getenv("ZONEINFO"); dir != "" {
		dirs = append([]string{dir}, dirs...)
	}
	for _, dir := range dirs {
		_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return fs.SkipDir
			}
			rel, _ := filepath.Rel(dir, path)
			if d.IsDir() {
				if rel == "posix" || rel == "right" {
					return fs.SkipDir
				}
				return nil
			}
			if d.Type().IsRegular() || d.Type()&fs.ModeSymlink != 0 {
				name := filepath.ToSlash(rel)
				if !strings.EqualFold(name, "localtime") {
					add(name)
				}
			}
			return nil
		})
	}
	return index
})

// LoadLocation resolves a time zone name the way cron-parser does, through
// Luxon and Intl:
//
//   - an empty name, "local", "system" or "default" is the local time zone;
//   - "utc" and "gmt" are UTC, and "utc+3" or "UTC-05:30" (Luxon's form) a
//     fixed offset;
//   - "+03:00", "+0300" or "+03" (Intl's form) is a fixed offset;
//   - anything else is an IANA name, or a legacy id ICU knows such as "PST",
//     matched without regard to case.
//
// Names the tz database has but Intl does not, such as "Factory", are
// accepted too. ICU's deprecated SystemV ids are not.
func LoadLocation(tz string) (*time.Location, error) {
	lower := strings.ToLower(tz)
	switch lower {
	case "", "default", "local", "system":
		return time.Local, nil
	case "utc", "gmt":
		return time.UTC, nil
	}
	if m := luxonOffsetRe.FindStringSubmatch(lower); m != nil {
		hours, _ := strconv.Atoi(m[1])
		minutes, _ := strconv.Atoi(m[2])
		if strings.HasPrefix(m[1], "-") {
			minutes = -minutes
		}
		return time.FixedZone(tz, (hours*60+minutes)*60), nil
	}
	if m := intlOffsetRe.FindStringSubmatch(tz); m != nil {
		hours, _ := strconv.Atoi(m[2])
		minutes, _ := strconv.Atoi(m[3])
		if hours <= 23 && minutes <= 59 {
			offset := (hours*60 + minutes) * 60
			if m[1] != "+" {
				offset = -offset
			}
			return time.FixedZone(tz, offset), nil
		}
	}
	if !ianaNameRe.MatchString(tz) {
		return nil, fmt.Errorf("cronparity: invalid time zone %q", tz)
	}
	name, ok := zoneIndex()[lower]
	if !ok {
		name, ok = icuAliases[lower]
	}
	if !ok {
		return nil, fmt.Errorf("cronparity: unknown time zone %q", tz)
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, fmt.Errorf("cronparity: time zone %q (%s) is not available: %w", tz, name, err)
	}
	return loc, nil
}
