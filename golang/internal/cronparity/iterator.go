package cronparity

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// ErrOutOfRange is returned by [Iterator.Next] when the next run would fall
// after the end date (cron-parser's "Out of the time span range").
var ErrOutOfRange = errors.New("cronparity: out of the time span range")

// ErrLoopLimit is returned by [Iterator.Next] when no run was found within
// cron-parser's iteration limit, for example for the 30th of February.
var ErrLoopLimit = errors.New("cronparity: invalid expression, loop limit exceeded")

// loopLimit is cron-parser's LOOP_LIMIT.
const loopLimit = 10000

var fixedZoneRe = regexp.MustCompile(`^utc(?:([+-]\d{1,2})(?::(\d{2}))?)?$`)

// LoadLocation resolves a time zone name the way cron-parser (through Luxon)
// does: an empty name, "local" or "system" is the local time zone, "utc" or
// "gmt" is UTC, "UTC+3" or "UTC-05:30" is a fixed offset, and anything else is
// an IANA time zone name.
func LoadLocation(tz string) (*time.Location, error) {
	lower := strings.ToLower(tz)
	switch lower {
	case "", "default", "local", "system":
		return time.Local, nil
	case "utc", "gmt":
		return time.UTC, nil
	}
	if m := fixedZoneRe.FindStringSubmatch(lower); m != nil {
		hours, _ := strconv.Atoi(m[1])
		minutes, _ := strconv.Atoi(m[2])
		offset := hours * 60
		if strings.HasPrefix(m[1], "-") {
			offset -= minutes
		} else {
			offset += minutes
		}
		return time.FixedZone(tz, offset*60), nil
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return nil, fmt.Errorf("cronparity: invalid time zone %q: %w", tz, err)
	}
	return loc, nil
}

// Options bound an iteration, as cron-parser's options do.
type Options struct {
	// CurrentDate is where the search starts; the first run is strictly
	// after it. The zero value means now.
	CurrentDate time.Time
	// StartDate, when set, moves an earlier CurrentDate forward to it.
	StartDate time.Time
	// EndDate, when set, makes Next fail with ErrOutOfRange instead of
	// returning a later run.
	EndDate time.Time
	// Location is the time zone the expression is evaluated in. Nil means
	// the local time zone, as in cron-parser.
	Location *time.Location
}

// Iterator walks the runs of an expression. It is not safe for concurrent
// use.
type Iterator struct {
	expr       *Expression
	loc        *time.Location
	cur        zdate
	start, end int64
	hasStart   bool
	hasEnd     bool
}

// Iterator returns an iterator over the runs of e, as
// CronExpressionParser.parse(expr, options) does.
func (e *Expression) Iterator(opts Options) *Iterator {
	loc := opts.Location
	if loc == nil {
		loc = time.Local
	}
	it := &Iterator{expr: e, loc: loc}
	current := opts.CurrentDate
	if current.IsZero() {
		current = opts.StartDate
	}
	if current.IsZero() {
		current = time.Now()
	}
	if !opts.StartDate.IsZero() {
		it.hasStart, it.start = true, opts.StartDate.UnixMilli()
	}
	if !opts.EndDate.IsZero() {
		it.hasEnd, it.end = true, opts.EndDate.UnixMilli()
	}
	switch ms := current.UnixMilli(); {
	case it.hasStart && ms < it.start:
		current = opts.StartDate
	case it.hasEnd && ms > it.end:
		current = opts.EndDate
	}
	it.cur = newZdate(current.UnixMilli(), loc)
	return it
}

// Next returns the next run, in the iterator's location, and advances the
// iterator. It returns ErrOutOfRange once the runs pass the end date.
func (it *Iterator) Next() (time.Time, error) {
	e := it.expr
	hoursLength := len(e.hours)
	cur := it.cur
	startTimestamp := cur.ts
	if cur.millisecond() > 0 {
		cur.setMillisecond(0)
		cur.apply(unitSecond, hoursLength)
	}

	for step := 1; ; step++ {
		if step >= loopLimit {
			return time.Time{}, ErrLoopLimit
		}
		if (it.hasStart && cur.ts < it.start) || (it.hasEnd && cur.ts > it.end) {
			return time.Time{}, ErrOutOfRange
		}
		wall := cur.wall()
		if !contains(e.months, int(wall.Month())) {
			cur.apply(unitMonth, hoursLength)
			continue
		}
		if !e.matchDay(wall) {
			cur.apply(unitDayOfMonth, hoursLength)
			continue
		}
		if !it.matchHour(&cur) {
			continue
		}
		if !contains(e.minutes, cur.minute()) {
			e.moveToNextMinute(&cur)
			continue
		}
		if !contains(e.seconds, cur.second()) {
			e.moveToNextSecond(&cur)
			continue
		}
		if startTimestamp == cur.ts {
			cur.apply(unitSecond, hoursLength)
			continue
		}
		break
	}
	it.cur = cur
	return time.UnixMilli(cur.ts).In(it.loc), nil
}

// matchHour is cron-parser's #matchHour, including its DST handling.
func (it *Iterator) matchHour(cur *zdate) bool {
	e := it.expr
	hours := e.hours
	currentHour := cur.hour()
	isMatch := contains(hours, currentHour)
	isDstEnd := cur.dstEnd == currentHour

	// DST start: accept the landing hour when a skipped hour was scheduled.
	if cur.dstStart >= 0 && cur.dstStartLanding == currentHour {
		for skipped := cur.dstStart; skipped != currentHour; skipped = (skipped + 1) % 24 {
			if contains(hours, skipped) {
				return true
			}
		}
	}
	// DST end: do not return the repeated hour twice.
	if isDstEnd {
		cur.dstEnd = -1
		cur.apply(unitHour, len(hours))
		return false
	}
	if isMatch {
		return true
	}

	cur.clearDstStart()
	nextHour, ok := nearest(hours, currentHour)
	if !ok {
		cur.apply(unitDayOfMonth, len(hours))
		return false
	}
	if cur.isDstTransitionDay() {
		// Setting the hour directly could land on a skipped or repeated
		// time, so step hour by hour to record the transition.
		for i := 0; i < nextHour-currentHour; i++ {
			cur.apply(unitHour, len(hours))
			if cur.hour() >= nextHour {
				break
			}
		}
	} else {
		cur.setHour(nextHour)
	}
	cur.setMinute(e.minutes[0])
	cur.setSecond(e.seconds[0])
	return false
}

// moveToNextMinute is cron-parser's #moveToNextMinute.
func (e *Expression) moveToNextMinute(cur *zdate) {
	if next, ok := nearest(e.minutes, cur.minute()); ok {
		cur.setMinute(next)
		cur.setSecond(e.seconds[0])
		return
	}
	cur.apply(unitHour, len(e.hours))
	cur.setMinute(e.minutes[0])
	cur.setSecond(e.seconds[0])
}

// moveToNextSecond is cron-parser's #moveToNextSecond.
func (e *Expression) moveToNextSecond(cur *zdate) {
	if next, ok := nearest(e.seconds, cur.second()); ok {
		cur.setSecond(next)
		return
	}
	cur.apply(unitMinute, len(e.hours))
	cur.setSecond(e.seconds[0])
}

func contains(values []int, v int) bool {
	for _, x := range values {
		if x == v {
			return true
		}
	}
	return false
}

// nearest returns the first value greater than v.
func nearest(values []int, v int) (int, bool) {
	for _, x := range values {
		if x > v {
			return x, true
		}
	}
	return 0, false
}

// zdate is cron-parser's CronDate: an instant in a time zone, with Luxon's
// date arithmetic, plus the DST transition markers of the search.
type zdate struct {
	ts  int64 // Unix milliseconds
	off int64 // UTC offset in seconds
	loc *time.Location

	// Hours, or -1 when unset.
	dstStart, dstStartLanding, dstEnd int
}

func newZdate(ts int64, loc *time.Location) zdate {
	return zdate{ts: ts, off: offsetAt(loc, ts), loc: loc, dstStart: -1, dstStartLanding: -1, dstEnd: -1}
}

func offsetAt(loc *time.Location, ts int64) int64 {
	_, off := time.UnixMilli(ts).In(loc).Zone()
	return int64(off)
}

// wall returns the wall-clock time, held in UTC.
func (z *zdate) wall() time.Time { return time.UnixMilli(z.ts + z.off*1000).UTC() }

func (z *zdate) hour() int        { return z.wall().Hour() }
func (z *zdate) minute() int      { return z.wall().Minute() }
func (z *zdate) second() int      { return z.wall().Second() }
func (z *zdate) millisecond() int { return z.wall().Nanosecond() / int(time.Millisecond) }

func (z *zdate) clearDstStart() {
	z.dstStart, z.dstStartLanding = -1, -1
}

// fixOffset is Luxon's fixOffset: it finds the instant of the wall-clock time
// localTS (Unix milliseconds of the wall time read as UTC), starting from the
// guessed offset o. A repeated time resolves to the guessed offset when it is
// one of its offsets; a skipped time resolves to the time the clock lands on.
func (z *zdate) fixOffset(localTS, o int64) (int64, int64) {
	utcGuess := localTS - o*1000
	o2 := offsetAt(z.loc, utcGuess)
	if o == o2 {
		return utcGuess, o
	}
	utcGuess -= (o2 - o) * 1000
	o3 := offsetAt(z.loc, utcGuess)
	if o2 == o3 {
		return utcGuess, o2
	}
	return localTS - min(o2, o3)*1000, max(o2, o3)
}

// setWall moves to the given wall-clock time, as Luxon's set does.
func (z *zdate) setWall(t time.Time) {
	z.ts, z.off = z.fixOffset(t.UnixMilli(), z.off)
}

// plusCalendar adds months and days to the wall-clock date, keeping the
// time of day, as Luxon's plus does for calendar units.
func (z *zdate) plusCalendar(months, days int) {
	w := z.wall()
	year, month := w.Year(), int(w.Month())+months
	day := min(w.Day(), lastDay(year, month)) + days
	local := time.Date(year, time.Month(month), day, w.Hour(), w.Minute(), w.Second(), w.Nanosecond(), time.UTC)
	z.ts, z.off = z.fixOffset(local.UnixMilli(), z.off)
}

// plusMillis adds an exact duration, as Luxon's plus does for time units.
func (z *zdate) plusMillis(ms int64) {
	ts, _ := z.fixOffset(z.wall().UnixMilli(), z.off)
	z.ts = ts + ms
	z.off = offsetAt(z.loc, z.ts)
}

// lastDay returns the number of days of month (which may overflow) of year.
func lastDay(year, month int) int {
	return time.Date(year, time.Month(month)+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

// startOf truncates the wall-clock time to the start of u, as Luxon's
// startOf does.
func (z *zdate) startOf(u unit) {
	w := z.wall()
	y, mo, d, h, mi, s := w.Year(), w.Month(), w.Day(), w.Hour(), w.Minute(), w.Second()
	switch u {
	case unitMonth:
		d, h, mi, s = 1, 0, 0, 0
	case unitDayOfMonth:
		h, mi, s = 0, 0, 0
	case unitHour:
		mi, s = 0, 0
	case unitMinute:
		s = 0
	}
	z.setWall(time.Date(y, mo, d, h, mi, s, 0, time.UTC))
}

// set changes one wall-clock field, skipping Luxon's set when the value does
// not change, as CronDate does.
func (z *zdate) set(u unit, v int) {
	w := z.wall()
	y, mo, d, h, mi, s, ns := w.Year(), w.Month(), w.Day(), w.Hour(), w.Minute(), w.Second(), w.Nanosecond()
	var cur int
	switch u {
	case unitHour:
		cur, h = h, v
	case unitMinute:
		cur, mi = mi, v
	case unitSecond:
		cur, s = s, v
	}
	if cur == v {
		return
	}
	z.setWall(time.Date(y, mo, d, h, mi, s, ns, time.UTC))
}

func (z *zdate) setHour(h int)   { z.set(unitHour, h) }
func (z *zdate) setMinute(m int) { z.set(unitMinute, m) }
func (z *zdate) setSecond(s int) { z.set(unitSecond, s) }

func (z *zdate) setMillisecond(ms int) {
	w := z.wall()
	if w.Nanosecond()/int(time.Millisecond) == ms {
		return
	}
	z.setWall(time.Date(w.Year(), w.Month(), w.Day(), w.Hour(), w.Minute(), w.Second(), ms*int(time.Millisecond), time.UTC))
}

// add is CronDate's addMonth, addDay, addHour, addMinute and addSecond.
func (z *zdate) add(u unit) {
	switch u {
	case unitMonth:
		z.plusCalendar(1, 0)
		z.startOf(unitMonth)
	case unitDayOfMonth:
		z.plusCalendar(0, 1)
		z.startOf(unitDayOfMonth)
	case unitHour:
		z.plusMillis(int64(time.Hour / time.Millisecond))
		z.startOf(unitHour)
	case unitMinute:
		z.plusMillis(int64(time.Minute / time.Millisecond))
		z.startOf(unitMinute)
	case unitSecond:
		z.plusMillis(1000)
	}
}

// apply is CronDate's applyDateOperation for forward steps: it records the
// hours skipped by a spring-forward transition and the hour repeated by a
// fall-back one, unless every hour is scheduled.
func (z *zdate) apply(u unit, hoursLength int) {
	if u == unitMonth || u == unitDayOfMonth {
		z.add(u)
		// The hours a DST change skipped belong to the day that was left.
		z.clearDstStart()
		// A day starts at 00:00, or at the first hour that exists when a DST
		// change skips midnight.
		if hoursLength != 24 && z.hour() > 0 {
			z.dstStart, z.dstStartLanding = 0, z.hour()
		}
		return
	}
	previousHour, previousOffset := z.hour(), z.off
	z.add(u)
	currentHour := z.hour()
	advance := (currentHour - previousHour + 24) % 24
	if z.off > previousOffset && advance >= 2 {
		if hoursLength != 24 {
			z.dstStart, z.dstStartLanding = (previousHour+1)%24, currentHour
		}
	} else if advance == 0 && z.minute() == 0 && z.second() == 0 {
		if hoursLength != 24 {
			z.dstEnd = currentHour
		}
	}
}

// isDstTransitionDay reports whether the UTC offset changes during the
// current wall-clock day.
func (z *zdate) isDstTransitionDay() bool {
	startOfDay := *z
	startOfDay.startOf(unitDayOfMonth)
	endOfDay := *z
	endOfDay.plusCalendar(0, 1)
	endOfDay.startOf(unitDayOfMonth)
	endOfDay.plusMillis(-1)
	return startOfDay.off != endOfDay.off
}
