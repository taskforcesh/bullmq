// The types declaration is wrong for xread, so we need to cast returns until its fixed
//
// https://github.com/DefinitelyTyped/DefinitelyTyped/issues/44301
//
export type StreamName = string;
export type EntryId = string;
export type EntryRaw = [EntryId, string[]];
export type StreamReadRaw = [StreamName, EntryRaw[]][]; // [string, [string, string[]][]][]
