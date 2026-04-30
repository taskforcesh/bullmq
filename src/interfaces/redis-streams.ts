// The types declaration is wrong for xread, so we need to cast returns until its fixed
//
// https://github.com/DefinitelyTyped/DefinitelyTyped/issues/44301
//

/**
 * The key/name of a Redis stream.
 */
export type StreamName = string;

/**
 * Identifier of a single entry within a Redis stream
 * (typically the millisecond timestamp and a sequence, e.g. `1700000000000-0`).
 */
export type EntryId = string;

/**
 * A raw entry returned by Redis stream commands such as `XREAD`.
 *
 * The first element is the entry id, and the second is a flat list of
 * alternating field/value pairs as returned by Redis.
 */
export type EntryRaw = [EntryId, string[]];

/**
 * The raw response shape of an `XREAD` (or similar) call against one or
 * more streams.
 *
 * Each top-level tuple pairs a stream name with the list of entries that
 * were read from it. The result is `null`/`undefined` when the call
 * returns no data (for example, when a blocking read times out).
 *
 * @see {@link https://redis.io/commands/xread/}
 */
export type StreamReadRaw = [StreamName, EntryRaw[]][] | null | undefined; // [string, [string, string[]][]][]
