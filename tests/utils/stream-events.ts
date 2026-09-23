export function streamEntriesToEvents(
  entries: [string, string[]][],
): Record<string, string>[] {
  return entries.map(([, fields]) => {
    const event: Record<string, string> = {};
    for (let i = 0; i + 1 < fields.length; i += 2) {
      event[fields[i]] = fields[i + 1];
    }
    return event;
  });
}
