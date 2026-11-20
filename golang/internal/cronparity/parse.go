// Package cronparity evaluates cron expressions exactly like cron-parser
// 5.10.5, the library the Node.js BullMQ uses for job scheduler patterns, so
// a Go worker computes the same next runs, and therefore the same job ids, as
// a Node.js worker would.
//
// Day matching is delegated to github.com/adhocore/gronx, which implements
// Vixie cron semantics, including the L and # day modifiers. This package
// adds what gronx does differently from cron-parser:
//
//   - parsing and validation follow cron-parser: 5 or 6 fields (leading
//     seconds when there are 6), names, Sunday as 0 or 7, cron-parser's
//     predefined expressions, and its errors, for example for W, duplicated
//     values or out-of-range steps. Fields are normalized into explicit lists
//     before gronx sees them, so steps and wildcards mean exactly what they
//     mean in cron-parser;
//   - the search for the next run is cron-parser's, on wall-clock time in an
//     IANA time zone, including its DST behaviour: a time skipped by a
//     spring-forward transition fires once, at the time the clock lands on,
//     and a time repeated by a fall-back transition fires once, on its first
//     occurrence (both copies fire when every hour is scheduled);
//   - start and end dates bound the search.
//
// Hashed (H) expressions are not supported.
package cronparity

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/adhocore/gronx"
)

// ParseError reports an expression that cron-parser rejects. Msg is
// cron-parser's message.
type ParseError struct {
	Expr string
	Msg  string
}

func (e *ParseError) Error() string {
	return fmt.Sprintf("cronparity: invalid cron expression %q: %s", e.Expr, e.Msg)
}

// Expression is a parsed cron expression. It is immutable and safe for
// concurrent use.
type Expression struct {
	expr    string
	seconds []int
	minutes []int
	hours   []int
	months  []int

	// Days are matched by gronx against these normalized segments.
	domSeg, dowSeg           string
	domWildcard, dowWildcard bool
}

// String returns the expression as it was given.
func (e *Expression) String() string { return e.expr }

type unit int

const (
	unitSecond unit = iota
	unitMinute
	unitHour
	unitDayOfMonth
	unitMonth
	unitDayOfWeek
)

type constraint struct {
	name      string // cron-parser's CronUnit, used in messages
	class     string // cron-parser's field class, used in messages
	min, max  int
	validChar *regexp.Regexp
}

// hashedChars are the alternatives of cron-parser's validChars that accept
// hashed (H) expressions anywhere in a field.
const hashedChars = `|^.*H\(\d+-\d+\)\/\d+.*$|^.*H\(\d+-\d+\).*$|^.*H\/\d+.*$`

var (
	baseChars = regexp.MustCompile(`^[?,*\dH/-]+$` + hashedChars)
	domChars  = regexp.MustCompile(`^[?,*\dLH/-]+$` + hashedChars)
	dowChars  = regexp.MustCompile(`^[?,*\dLH#/-]+$` + hashedChars)
	aliasRe   = regexp.MustCompile(`[a-zA-Z]{3}`)
	digitsRe  = regexp.MustCompile(`^\d+$`)
	intRe     = regexp.MustCompile(`^-?\d+$`)
	dowLastRe = regexp.MustCompile(`^[0-7]?L$`)
	nthBadRe  = regexp.MustCompile(`[,\-/L]`)
	spacesRe  = regexp.MustCompile(`\s+`)
)

var constraints = map[unit]constraint{
	unitSecond:     {"Second", "CronSecond", 0, 59, baseChars},
	unitMinute:     {"Minute", "CronMinute", 0, 59, baseChars},
	unitHour:       {"Hour", "CronHour", 0, 23, baseChars},
	unitDayOfMonth: {"DayOfMonth", "CronDayOfMonth", 1, 31, domChars},
	unitMonth:      {"Month", "CronMonth", 1, 12, baseChars},
	unitDayOfWeek:  {"DayOfWeek", "CronDayOfWeek", 0, 7, dowChars},
}

var predefined = map[string]string{
	"@yearly":   "0 0 0 1 1 *",
	"@annually": "0 0 0 1 1 *",
	"@monthly":  "0 0 0 1 * *",
	"@weekly":   "0 0 0 * * 0",
	"@daily":    "0 0 0 * * *",
	"@hourly":   "0 0 * * * *",
	"@minutely": "0 * * * * *",
	"@secondly": "* * * * * *",
	"@weekdays": "0 0 0 * * 1-5",
	"@weekends": "0 0 0 * * 0,6",
}

var monthAliases = map[string]int{
	"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
	"jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

var dowAliases = map[string]int{
	"sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6,
}

// daysInMonth is cron-parser's DAYS_IN_MONTH, with 29 days for February.
var daysInMonth = [12]int{31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}

const (
	maxFieldValues   = 256
	maxExpressionLen = 1024
	// maxStep bounds steps: any step wider than a field behaves the same.
	maxStep = 1000
)

// fieldValues are the values of a parsed field: numbers, plus the L tokens
// of the day fields.
type fieldValues struct {
	nums  []int
	lasts []string
}

// Parse parses expr as cron-parser's CronExpressionParser.parse does (without
// the strict option), and rejects what it rejects.
func Parse(expr string) (*Expression, error) {
	fail := func(msg string) error {
		return &ParseError{Expr: expr, Msg: msg}
	}
	source := expr
	if p, ok := predefined[source]; ok {
		source = p
	}
	if source == "" {
		source = "0 * * * * *"
	}
	if len(source) > maxExpressionLen {
		return nil, fail(fmt.Sprintf("Invalid cron expression, too long, expected at most %d characters", maxExpressionLen))
	}
	atoms := spacesRe.Split(strings.TrimSpace(source), -1)
	if len(atoms) > 6 {
		return nil, fail("Invalid cron expression, too many fields")
	}
	defaults := []string{"0", "*", "*", "*", "*", "*"}
	if len(atoms) < len(defaults) {
		atoms = append(slices.Clone(defaults[:len(defaults)-len(atoms)]), atoms...)
	}
	raw := map[unit]string{
		unitSecond: atoms[0], unitMinute: atoms[1], unitHour: atoms[2],
		unitDayOfMonth: atoms[3], unitMonth: atoms[4], unitDayOfWeek: atoms[5],
	}

	parsed := make(map[unit]fieldValues, 6)
	for _, u := range []unit{unitSecond, unitMinute, unitHour, unitMonth, unitDayOfMonth} {
		v, msg := parseField(u, raw[u])
		if msg != "" {
			return nil, fail(msg)
		}
		parsed[u] = v
	}
	dowRaw, nth, msg := parseNthDay(raw[unitDayOfWeek])
	if msg != "" {
		return nil, fail(msg)
	}
	dow, msg := parseField(unitDayOfWeek, dowRaw)
	if msg != "" {
		return nil, fail(msg)
	}

	// Field validation, in the order cron-parser builds the fields. A
	// single month drops the days it does not have, unless none is left.
	dom := parsed[unitDayOfMonth]
	if months := parsed[unitMonth].nums; len(months) == 1 && len(parsed[unitMonth].lasts) == 0 {
		limit := daysInMonth[months[0]-1]
		var kept []int
		for _, d := range dom.nums {
			if d <= limit {
				kept = append(kept, d)
			}
		}
		if len(kept) > 0 || len(dom.lasts) > 0 {
			dom.nums = kept
		}
	}
	for _, f := range []struct {
		u unit
		v fieldValues
	}{
		{unitSecond, parsed[unitSecond]}, {unitMinute, parsed[unitMinute]},
		{unitHour, parsed[unitHour]}, {unitDayOfMonth, dom},
		{unitMonth, parsed[unitMonth]}, {unitDayOfWeek, dow},
	} {
		if msg := validate(f.u, f.v); msg != "" {
			return nil, fail(msg)
		}
	}
	if slices.Contains(dow.lasts, "L") {
		return nil, fail("CronDayOfWeek Validation error, unexpected standalone L")
	}
	// A day of month that no listed month has is invalid, unless the day of
	// week is restricted too (either may then match).
	domWildcard := raw[unitDayOfMonth] == "*" || raw[unitDayOfMonth] == "?"
	dowWildcard := raw[unitDayOfWeek] == "*" || raw[unitDayOfWeek] == "?"
	if !strings.Contains(raw[unitDayOfMonth], "L") && dowWildcard {
		longest := 0
		for _, m := range parsed[unitMonth].nums {
			longest = max(longest, daysInMonth[m-1])
		}
		if slices.Min(dom.nums) > longest {
			return nil, fail("Invalid explicit day of month definition")
		}
	}

	e := &Expression{
		expr:        expr,
		seconds:     sortedUnique(parsed[unitSecond].nums),
		minutes:     sortedUnique(parsed[unitMinute].nums),
		hours:       sortedUnique(parsed[unitHour].nums),
		months:      sortedUnique(parsed[unitMonth].nums),
		domWildcard: domWildcard,
		dowWildcard: dowWildcard,
	}
	e.domSeg = daySegment(dom, 0, e.domWildcard, false)
	e.dowSeg = daySegment(dow, nth, e.dowWildcard, true)

	// gronx must accept the normalized expression; anything else is a bug in
	// the normalization.
	normalized := strings.Join([]string{
		joinInts(e.seconds), joinInts(e.minutes), joinInts(e.hours),
		e.domSeg, joinInts(e.months), e.dowSeg,
	}, " ")
	if !gronx.IsValid(normalized) {
		return nil, fail(fmt.Sprintf("normalized expression %q was rejected by gronx", normalized))
	}
	return e, nil
}

// parseField is cron-parser's #parseField. It returns a non-empty message on
// error.
func parseField(u unit, value string) (fieldValues, string) {
	c := constraints[u]
	if u == unitMonth || u == unitDayOfWeek {
		aliases := monthAliases
		if u == unitDayOfWeek {
			aliases = dowAliases
		}
		var aliasErr string
		value = aliasRe.ReplaceAllStringFunc(value, func(m string) string {
			n, ok := aliases[strings.ToLower(m)]
			if !ok {
				if aliasErr == "" {
					aliasErr = fmt.Sprintf("Validation error, cannot resolve alias %q", strings.ToLower(m))
				}
				return m
			}
			return strconv.Itoa(n)
		})
		if aliasErr != "" {
			return fieldValues{}, aliasErr
		}
	}
	if !c.validChar.MatchString(value) {
		return fieldValues{}, "Invalid characters, got value: " + value
	}
	if strings.Contains(value, "H") {
		return fieldValues{}, "Hashed (H) expressions are not supported, got value: " + value
	}

	// Only a whole list item, optionally followed by a step, stands for the
	// full range.
	items := strings.Split(value, ",")
	for i, item := range items {
		if item != "" && (item[0] == '*' || item[0] == '?') && (len(item) == 1 || item[1] == '/') {
			items[i] = fmt.Sprintf("%d-%d", c.min, c.max) + item[1:]
		}
	}
	if strings.ContainsAny(strings.Join(items, ","), "*?") {
		return fieldValues{}, "Invalid wildcard, got value: " + value
	}

	var out fieldValues
	for _, item := range items {
		if len(out.nums)+len(out.lasts) > maxFieldValues {
			return fieldValues{}, fmt.Sprintf("Constraint error, too many values in %s field, expected at most %d", c.name, maxFieldValues)
		}
		if item == "" {
			return fieldValues{}, "Invalid list value format"
		}
		nums, one, msg := parseRepeat(u, item)
		if msg != "" {
			return fieldValues{}, msg
		}
		if nums != nil {
			out.nums = append(out.nums, nums...)
			continue
		}
		if (u == unitDayOfMonth || u == unitDayOfWeek) && strings.Contains(one.str, "L") {
			out.lasts = append(out.lasts, one.str)
			continue
		}
		if one.nan || one.num < float64(c.min) || one.num > float64(c.max) {
			return fieldValues{}, fmt.Sprintf("Constraint error, got value %s expected range %d-%d", one.str, c.min, c.max)
		}
		v := int(one.num)
		if u == unitDayOfWeek {
			v %= 7
		}
		out.nums = append(out.nums, v)
	}
	return out, ""
}

// number is a value converted like JavaScript's unary plus does.
type number struct {
	str string // the value as JavaScript prints it, or the raw text when NaN
	num float64
	nan bool
}

func (n number) String() string {
	if n.nan {
		return "NaN"
	}
	return n.str
}

// jsNumber converts s like JavaScript's unary plus does, for the characters a
// cron field may contain.
func jsNumber(s string) number {
	if s == "" {
		return number{str: "0"}
	}
	if !intRe.MatchString(s) {
		return number{str: s, nan: true}
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return number{str: s, nan: true}
	}
	if f == 0 {
		return number{str: "0"}
	}
	return number{str: strconv.FormatFloat(f, 'f', -1, 64), num: f}
}

// parseRepeat is cron-parser's #parseRepeat. It returns the values of a
// range, or the value of an item that is not a range.
func parseRepeat(u unit, item string) ([]int, number, string) {
	parts := strings.Split(item, "/")
	if len(parts) > 2 {
		return nil, number{}, "Invalid repeat: " + item
	}
	if len(parts) == 2 {
		rng := parts[0]
		if !strings.Contains(rng, "-") {
			rng = fmt.Sprintf("%s-%d", rng, constraints[u].max)
		}
		return parseRange(u, rng, jsNumber(parts[1]))
	}
	return parseRange(u, item, number{str: "1", num: 1})
}

// parseRange is cron-parser's #parseRange and #createRange.
func parseRange(u unit, val string, step number) ([]int, number, string) {
	c := constraints[u]
	atoms := strings.Split(val, "-")
	if len(atoms) <= 1 {
		return nil, jsNumber(val), ""
	}
	if len(atoms) > 2 {
		return nil, number{}, "Invalid range: " + val
	}
	lo, hi := digitsOrNaN(atoms[0]), digitsOrNaN(atoms[1])
	if lo.nan || hi.nan || lo.num < float64(c.min) || hi.num > float64(c.max) {
		return nil, number{}, fmt.Sprintf("Constraint error, got range %s-%s expected range %d-%d", lo, hi, c.min, c.max)
	}
	if lo.num > hi.num {
		return nil, number{}, fmt.Sprintf("Invalid range: %s-%s, min(%s) > max(%s)", lo, hi, lo, hi)
	}
	if step.nan || step.num <= 0 {
		return nil, number{}, fmt.Sprintf("Constraint error, cannot repeat at every %s time.", step)
	}
	minV, maxV := int(lo.num), int(hi.num)
	stepV := int(min(step.num, maxStep))
	values := make([]int, 0, (maxV-minV)/stepV+2)
	if u == unitDayOfWeek && maxV%7 == 0 && (maxV-minV)%stepV == 0 {
		values = append(values, 0)
	}
	for i := minV; i <= maxV; i += stepV {
		if !slices.Contains(values, i) {
			values = append(values, i)
		}
	}
	return values, number{}, ""
}

func digitsOrNaN(s string) number {
	if !digitsRe.MatchString(s) {
		return number{str: s, nan: true}
	}
	return jsNumber(s)
}

// parseNthDay is cron-parser's #parseNthDay: it splits the nth occurrence
// (#) off the day-of-week field.
func parseNthDay(val string) (string, int, string) {
	atoms := strings.Split(val, "#")
	if len(atoms) <= 1 {
		return atoms[0], 0, ""
	}
	nth := jsNumber(atoms[len(atoms)-1])
	if m := nthBadRe.FindString(val); m != "" {
		return "", 0, fmt.Sprintf("Constraint error, invalid dayOfWeek `#` and `%s` special characters are incompatible", m)
	}
	if len(atoms) > 2 || nth.nan || nth.num < 1 || nth.num > 5 {
		return "", 0, "Constraint error, invalid dayOfWeek occurrence number (#)"
	}
	return atoms[0], int(nth.num), ""
}

// validate is the validation of cron-parser's field constructors: values in
// range, valid tokens and no duplicates.
func validate(u unit, v fieldValues) string {
	c := constraints[u]
	nums := slices.Clone(v.nums)
	slices.Sort(nums)
	lasts := slices.Clone(v.lasts)
	slices.Sort(lasts)
	chars := ""
	if u == unitDayOfMonth || u == unitDayOfWeek {
		chars = " or chars L"
	}
	for _, n := range nums {
		if n < c.min || n > c.max {
			return fmt.Sprintf("%s Validation error, got value %d expected range %d-%d%s", c.class, n, c.min, c.max, chars)
		}
	}
	for _, l := range lasts {
		if (u == unitDayOfMonth && l != "L") || (u == unitDayOfWeek && !dowLastRe.MatchString(l)) {
			return fmt.Sprintf("%s Validation error, got value %s expected range %d-%d%s", c.class, l, c.min, c.max, chars)
		}
	}
	for i := 1; i < len(nums); i++ {
		if nums[i] == nums[i-1] {
			return fmt.Sprintf("%s Validation error, duplicate values found: %d", c.class, nums[i])
		}
	}
	for i := 1; i < len(lasts); i++ {
		if lasts[i] == lasts[i-1] {
			return fmt.Sprintf("%s Validation error, duplicate values found: %s", c.class, lasts[i])
		}
	}
	return ""
}

// daySegment renders a day field for gronx: an explicit list of days, the L
// tokens and, for the day of week, the nth occurrence of every listed day.
func daySegment(v fieldValues, nth int, wildcard, weekday bool) string {
	if wildcard {
		return "*"
	}
	nums := v.nums
	if weekday {
		nums = make([]int, len(v.nums))
		for i, n := range v.nums {
			nums[i] = n % 7
		}
	}
	nums = sortedUnique(nums)
	parts := make([]string, 0, len(nums)+len(v.lasts))
	for _, n := range nums {
		if nth > 0 {
			parts = append(parts, fmt.Sprintf("%d#%d", n, nth))
		} else {
			parts = append(parts, strconv.Itoa(n))
		}
	}
	parts = append(parts, v.lasts...)
	return strings.Join(parts, ",")
}

func sortedUnique(v []int) []int {
	out := slices.Clone(v)
	slices.Sort(out)
	return slices.Compact(out)
}

func joinInts(v []int) string {
	parts := make([]string, len(v))
	for i, n := range v {
		parts[i] = strconv.Itoa(n)
	}
	return strings.Join(parts, ",")
}

// matchDay reports whether the calendar day of wall (a wall-clock time held
// in UTC) matches the day-of-month and day-of-week fields, with cron-parser's
// rules: when both fields are restricted, either may match.
func (e *Expression) matchDay(wall time.Time) bool {
	checker := &gronx.SegmentChecker{}
	checker.SetRef(time.Date(wall.Year(), wall.Month(), wall.Day(), 12, 0, 0, 0, time.UTC))
	dom, _ := checker.CheckDue(e.domSeg, 3)
	dow, _ := checker.CheckDue(e.dowSeg, 5)
	switch {
	case !e.domWildcard && !e.dowWildcard:
		return dom || dow
	case e.dowWildcard:
		return dom
	default:
		return dow
	}
}
