export type JobSearchRawResponse = [
  /// search metadata
  string,
  /// Job data
  ...(string | any)[],
];
