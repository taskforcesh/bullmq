package bullmq

import (
	"bytes"

	"github.com/vmihailenco/msgpack/v5"
)

// packMsgpack encodes v as MessagePack for the shared Lua commands, which
// decode their packed arguments with `cmsgpack.unpack`.
//
// It is the counterpart of the `Packr` instance the Node.js implementation
// uses (see src/classes/redis-queue-backend.ts), so the encoder is configured
// to stay on the subset every port agrees on:
//
//   - integers use their smallest representation;
//   - map keys are sorted, so the same options always produce the same bytes;
//   - no extension types are emitted.
//
// Strings must be passed as Go strings, never as []byte, which the encoder
// would write using the `bin` family instead of `str`.
func packMsgpack(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := msgpack.NewEncoder(&buf)
	enc.UseCompactInts(true)
	enc.SetSortMapKeys(true)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
