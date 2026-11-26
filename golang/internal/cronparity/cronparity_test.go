package cronparity

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// vector is a ground-truth case generated with cron-parser 5.10.5 or 5.10.6,
// which give the same results: the runs
// that CronExpressionParser.parse(pattern, {tz, currentDate, startDate,
// endDate}).next() returns, or the error it throws.
type vector struct {
	ID             string  `json:"id"`
	Pattern        string  `json:"pattern"`
	Tz             *string `json:"tz"`
	CurrentDate    *string `json:"currentDate"`
	StartDate      *string `json:"startDate"`
	EndDate        *string `json:"endDate"`
	RequestedCount int     `json:"requestedCount"`
	ExpectedNext   []struct {
		EpochMs int64 `json:"epochMs"`
	} `json:"expectedNext"`
	ExpectedError *string `json:"expectedError"`
}

func loadVectors(t *testing.T, name string) []vector {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", name))
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Vectors []vector `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Vectors) == 0 {
		t.Fatalf("%s has no vectors", name)
	}
	return file.Vectors
}

func parseDate(t *testing.T, s *string) time.Time {
	t.Helper()
	if s == nil {
		return time.Time{}
	}
	d, err := time.Parse(time.RFC3339Nano, *s)
	if err != nil {
		t.Fatal(err)
	}
	return d
}

// runtimeErrors are the errors cron-parser throws from next() rather than
// from parse().
var runtimeErrors = map[string]error{
	"Out of the time span range":              ErrOutOfRange,
	"Invalid expression, loop limit exceeded": ErrLoopLimit,
}

func runVector(t *testing.T, v vector) {
	t.Helper()
	tz := ""
	if v.Tz != nil {
		tz = *v.Tz
	}
	loc, err := LoadLocation(tz)
	if err != nil {
		t.Fatal(err)
	}
	var wantErr error
	if v.ExpectedError != nil {
		wantErr = runtimeErrors[*v.ExpectedError]
	}
	expr, err := Parse(v.Pattern)
	switch {
	case v.ExpectedError != nil && wantErr == nil:
		if err == nil {
			t.Fatalf("Parse(%q) succeeded, cron-parser fails with %q", v.Pattern, *v.ExpectedError)
		}
		var perr *ParseError
		if !errors.As(err, &perr) || perr.Msg != *v.ExpectedError {
			t.Fatalf("Parse(%q) = %v, want cron-parser's message %q", v.Pattern, err, *v.ExpectedError)
		}
		return
	case err != nil:
		t.Fatalf("Parse(%q): %v", v.Pattern, err)
	}

	it := expr.Iterator(Options{
		CurrentDate: parseDate(t, v.CurrentDate),
		StartDate:   parseDate(t, v.StartDate),
		EndDate:     parseDate(t, v.EndDate),
		Location:    loc,
	})
	var want []string
	for _, e := range v.ExpectedNext {
		want = append(want, time.UnixMilli(e.EpochMs).UTC().Format(time.RFC3339Nano))
	}
	var got []string
	var gotErr error
	for range v.RequestedCount {
		next, err := it.Next()
		if err != nil {
			gotErr = err
			break
		}
		got = append(got, next.UTC().Format(time.RFC3339Nano))
	}
	if strings.Join(got, " ") != strings.Join(want, " ") || !errors.Is(gotErr, wantErr) || (gotErr != nil) != (wantErr != nil) {
		t.Fatalf("pattern %q tz %s from %s:\n got  %v, %v\n want %v, %v", v.Pattern, tz, *v.CurrentDate, got, gotErr, want, wantErr)
	}
}

// TestCronParserVectors checks the 29 reference vectors of the design
// research: field syntax, L and #, names, Vixie OR semantics, DST
// transitions in New York and Madrid, end dates and predefined expressions.
func TestCronParserVectors(t *testing.T) {
	for _, v := range loadVectors(t, "cron-vectors.json") {
		t.Run(v.ID, func(t *testing.T) { runVector(t, v) })
	}
}

// TestCronParserDifferentialVectors checks cases sampled at random around DST
// transitions (including half-hour, midnight and southern-hemisphere ones)
// and odd field syntax, generated with cron-parser 5.10.6.
func TestCronParserDifferentialVectors(t *testing.T) {
	for _, v := range loadVectors(t, "cron-vectors-random.json") {
		t.Run(v.ID, func(t *testing.T) { runVector(t, v) })
	}
}

func TestParseRejectsWhatCronParserRejects(t *testing.T) {
	for _, pattern := range []string{
		"0 0 15W * *",
		"0 0 LW * *",
		"0 0 * * 5#6",
		"0 0 * * 1#1,2#1",
		"0 0 * * L",
		"0 0 5L * *",
		"0 0,0 * * *",
		"0 0 * * 0,7",
		"0 0 * * 6-7,0",
		"*/0 * * * *",
		"5-1 * * * *",
		"60 * * * *",
		"0 0 * * * * *",
		"0 0 * FOO *",
		"0 0 * * MONDAY",
		"H * * * *",
		"*5 * * * *",
		"1,,2 * * * *",
		"0 0 0/5 * *",
		"0 0 * * * 2026",
		"0 0 30 2 *",
	} {
		if _, err := Parse(pattern); err == nil {
			t.Errorf("Parse(%q) succeeded, want an error", pattern)
		}
	}
}

func TestParseAcceptsCronParserSyntax(t *testing.T) {
	for _, pattern := range []string{
		"* * * * *",
		"? ? ? ? ?",
		"0 9 * * 1-5",
		"0 0 * * THU",
		"0 0 1 jan,Jul *",
		"0 0 * * sun-sat",
		"0 0 * * 7L",
		"0 0 * * *#2",
		"0 0 L 2 *",
		"5/15 * * * * *",
		"0 0 1 * 1",
		"0 0 1,31 2 *",
		"@weekdays",
		"@yearly",
		"",
		"9 *",
	} {
		if _, err := Parse(pattern); err != nil {
			t.Errorf("Parse(%q): %v", pattern, err)
		}
	}
}

func TestDayOfWeekStepIncludesSunday(t *testing.T) {
	// cron-parser expands "1/2" to 1-7/2, which includes Sunday (7); gronx
	// alone would not.
	expr, err := Parse("0 0 0 * * 1/2")
	if err != nil {
		t.Fatal(err)
	}
	it := expr.Iterator(Options{
		CurrentDate: time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC), // a Friday
		Location:    time.UTC,
	})
	var got []time.Weekday
	for range 4 {
		next, err := it.Next()
		if err != nil {
			t.Fatal(err)
		}
		got = append(got, next.Weekday())
	}
	want := []time.Weekday{time.Sunday, time.Monday, time.Wednesday, time.Friday}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("runs on %v, want %v", got, want)
		}
	}
}

func TestStartAndEndDates(t *testing.T) {
	expr, err := Parse("0 * * * *")
	if err != nil {
		t.Fatal(err)
	}
	base := time.Date(2026, 6, 1, 0, 30, 0, 0, time.UTC)
	it := expr.Iterator(Options{
		CurrentDate: base,
		StartDate:   base.Add(2 * time.Hour),
		EndDate:     base.Add(4 * time.Hour),
		Location:    time.UTC,
	})
	for _, want := range []time.Time{base.Add(150 * time.Minute), base.Add(210 * time.Minute)} {
		next, err := it.Next()
		if err != nil || !next.Equal(want) {
			t.Fatalf("Next() = %v, %v; want %v", next, err, want)
		}
	}
	if next, err := it.Next(); !errors.Is(err, ErrOutOfRange) {
		t.Fatalf("Next() = %v, %v; want ErrOutOfRange", next, err)
	}
}

func TestLoadLocation(t *testing.T) {
	for tz, wantOffset := range map[string]int{
		"UTC":              0,
		"utc+3":            3 * 3600,
		"UTC-05:30":        -(5*3600 + 30*60),
		"UTC+25":           25 * 3600,
		"+03:00":           3 * 3600,
		"+0300":            3 * 3600,
		"-03":              -3 * 3600,
		"\u221205:30":      -(5*3600 + 30*60),
		"Etc/GMT+3":        -3 * 3600,
		"etc/gmt-14":       14 * 3600,
		"Asia/Tokyo":       9 * 3600,
		"america/new_york": -5 * 3600,
		"AMERICA/NEW_YORK": -5 * 3600,
		"us/eastern":       -5 * 3600,
		"pst":              -8 * 3600,
		"IST":              5*3600 + 30*60,
		"gb":               0,
	} {
		loc, err := LoadLocation(tz)
		if err != nil {
			t.Fatalf("LoadLocation(%q): %v", tz, err)
		}
		_, off := time.Date(2026, 1, 15, 12, 0, 0, 0, loc).Zone()
		if off != wantOffset {
			t.Errorf("LoadLocation(%q) offset = %d, want %d", tz, off, wantOffset)
		}
	}
	for _, tz := range []string{"", "local", "System", "DEFAULT"} {
		if loc, err := LoadLocation(tz); err != nil || loc != time.Local {
			t.Errorf("LoadLocation(%q) = %v, %v; want the local zone", tz, loc, err)
		}
	}
	for _, tz := range []string{"Not/AZone", "+3", "+24:00", "+03:60", "UTC+0300", "GMT+3", "America//New_York", "../../etc/passwd", "UTC "} {
		if _, err := LoadLocation(tz); err == nil {
			t.Errorf("LoadLocation(%q) succeeded, want an error", tz)
		}
	}
}

// TestTimeZonesLikeCronParser checks time zone names against Node.js:
// every IANA name, in its own case and lowercased, ICU's legacy ids such as
// PST, and the fixed offset forms of Luxon and Intl. A name cron-parser
// accepts must resolve, to the same runs; a name it rejects must be
// rejected, except names only the tz database has.
func TestTimeZonesLikeCronParser(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "tz-vectors.json"))
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Meta struct {
			Pattern      string  `json:"pattern"`
			CurrentDates []int64 `json:"currentDates"`
		} `json:"meta"`
		Vectors []struct {
			Tz   string  `json:"tz"`
			OK   bool    `json:"ok"`
			Next []int64 `json:"next"`
		} `json:"vectors"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	expr, err := Parse(file.Meta.Pattern)
	if err != nil {
		t.Fatal(err)
	}
	// tz database names ICU does not have (America/Coyhaique is newer than
	// its tz 2024b).
	tzdataOnly := map[string]bool{
		"factory": true, "posixrules": true, "posix/america/new_york": true, "america/coyhaique": true,
	}
	checked := 0
	for _, v := range file.Vectors {
		loc, err := LoadLocation(v.Tz)
		if !v.OK {
			if err == nil && !tzdataOnly[strings.ToLower(v.Tz)] {
				t.Errorf("LoadLocation(%q) succeeded; cron-parser rejects it", v.Tz)
			}
			continue
		}
		if strings.HasPrefix(strings.ToLower(v.Tz), "systemv/") {
			// ICU's deprecated SystemV ids, which the tz database dropped,
			// are not supported.
			if err == nil {
				t.Errorf("LoadLocation(%q) succeeded, want SystemV ids unsupported", v.Tz)
			}
			continue
		}
		if err != nil {
			if strings.Contains(err.Error(), "is not available") {
				t.Logf("skipping %q: %v", v.Tz, err)
				continue
			}
			t.Errorf("LoadLocation(%q): %v; cron-parser accepts it", v.Tz, err)
			continue
		}
		checked++
		for i, want := range v.Next {
			next, err := expr.Iterator(Options{CurrentDate: time.UnixMilli(file.Meta.CurrentDates[i]), Location: loc}).Next()
			if err != nil || next.UnixMilli() != want {
				t.Errorf("%q: next run after %d = %v, %v; cron-parser computes %s", v.Tz,
					file.Meta.CurrentDates[i], next.UTC(), err, time.UnixMilli(want).UTC())
			}
		}
	}
	if checked < 1000 {
		t.Fatalf("only %d time zones were checked", checked)
	}
}
