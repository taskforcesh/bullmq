import { Job } from '../classes';

export interface FilteredJobsResult {
  cursor: number;
  total: number;
  count: number;
  jobs: Job[];
}
