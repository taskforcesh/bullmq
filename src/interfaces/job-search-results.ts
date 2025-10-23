import { JobJsonRaw } from './job-json';

export type JobSearchRawResponse = [
  /// search cursor
  number,
  /// total # of jobs in the list
  number,
  /// Job data
  ...(string | any)[],
];

export interface JobSearchResult {
  cursor: number;
  total: number;
  count: number;
  jobs: JobJsonRaw[];
}
