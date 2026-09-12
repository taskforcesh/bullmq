package bullmq

import (
	"encoding/binary"
	"math"
)

// msgpackWriter is a minimal MessagePack encoder covering exactly the value
// types the shared Lua commands decode with `cmsgpack.unpack`.
//
// A hand written encoder is used instead of a third-party dependency so the
// wire format stays byte-for-byte identical to the other BullMQ ports (in
// particular: no extension types, integers are encoded in their smallest
// representation and strings always use the `str` family).
type msgpackWriter struct {
	buf []byte
}

func newMsgpackWriter(capacity int) *msgpackWriter {
	return &msgpackWriter{buf: make([]byte, 0, capacity)}
}

// Bytes returns the encoded payload.
func (w *msgpackWriter) Bytes() []byte { return w.buf }

// Len returns the number of bytes written so far.
func (w *msgpackWriter) Len() int { return len(w.buf) }

// Raw appends already encoded MessagePack bytes.
func (w *msgpackWriter) Raw(b []byte) { w.buf = append(w.buf, b...) }

// Nil writes a nil value.
func (w *msgpackWriter) Nil() { w.buf = append(w.buf, 0xc0) }

// Bool writes a boolean value.
func (w *msgpackWriter) Bool(v bool) {
	if v {
		w.buf = append(w.buf, 0xc3)
	} else {
		w.buf = append(w.buf, 0xc2)
	}
}

// Uint writes an unsigned integer using its most compact representation.
func (w *msgpackWriter) Uint(v uint64) {
	switch {
	case v < 0x80:
		w.buf = append(w.buf, byte(v))
	case v <= math.MaxUint8:
		w.buf = append(w.buf, 0xcc, byte(v))
	case v <= math.MaxUint16:
		w.buf = append(w.buf, 0xcd)
		w.buf = binary.BigEndian.AppendUint16(w.buf, uint16(v))
	case v <= math.MaxUint32:
		w.buf = append(w.buf, 0xce)
		w.buf = binary.BigEndian.AppendUint32(w.buf, uint32(v))
	default:
		w.buf = append(w.buf, 0xcf)
		w.buf = binary.BigEndian.AppendUint64(w.buf, v)
	}
}

// Int writes a signed integer using its most compact representation.
func (w *msgpackWriter) Int(v int64) {
	if v >= 0 {
		w.Uint(uint64(v))
		return
	}
	switch {
	case v >= -32:
		w.buf = append(w.buf, byte(0xe0|(v+32)))
	case v >= math.MinInt8:
		w.buf = append(w.buf, 0xd0, byte(int8(v)))
	case v >= math.MinInt16:
		w.buf = append(w.buf, 0xd1)
		w.buf = binary.BigEndian.AppendUint16(w.buf, uint16(int16(v)))
	case v >= math.MinInt32:
		w.buf = append(w.buf, 0xd2)
		w.buf = binary.BigEndian.AppendUint32(w.buf, uint32(int32(v)))
	default:
		w.buf = append(w.buf, 0xd3)
		w.buf = binary.BigEndian.AppendUint64(w.buf, uint64(v))
	}
}

// Float writes a 64-bit floating point value.
func (w *msgpackWriter) Float(v float64) {
	w.buf = append(w.buf, 0xcb)
	w.buf = binary.BigEndian.AppendUint64(w.buf, math.Float64bits(v))
}

// Str writes a UTF-8 string.
func (w *msgpackWriter) Str(s string) {
	n := len(s)
	switch {
	case n < 32:
		w.buf = append(w.buf, byte(0xa0|n))
	case n <= math.MaxUint8:
		w.buf = append(w.buf, 0xd9, byte(n))
	case n <= math.MaxUint16:
		w.buf = append(w.buf, 0xda)
		w.buf = binary.BigEndian.AppendUint16(w.buf, uint16(n))
	default:
		w.buf = append(w.buf, 0xdb)
		w.buf = binary.BigEndian.AppendUint32(w.buf, uint32(n))
	}
	w.buf = append(w.buf, s...)
}

// ArrayLen writes an array header of n elements.
func (w *msgpackWriter) ArrayLen(n int) {
	switch {
	case n < 16:
		w.buf = append(w.buf, byte(0x90|n))
	case n <= math.MaxUint16:
		w.buf = append(w.buf, 0xdc)
		w.buf = binary.BigEndian.AppendUint16(w.buf, uint16(n))
	default:
		w.buf = append(w.buf, 0xdd)
		w.buf = binary.BigEndian.AppendUint32(w.buf, uint32(n))
	}
}

// MapLen writes a map header of n key/value pairs.
func (w *msgpackWriter) MapLen(n int) {
	switch {
	case n < 16:
		w.buf = append(w.buf, byte(0x80|n))
	case n <= math.MaxUint16:
		w.buf = append(w.buf, 0xde)
		w.buf = binary.BigEndian.AppendUint16(w.buf, uint16(n))
	default:
		w.buf = append(w.buf, 0xdf)
		w.buf = binary.BigEndian.AppendUint32(w.buf, uint32(n))
	}
}
