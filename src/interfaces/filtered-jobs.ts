import { Job } from '../classes';

export interface FilteredJobsResult {
  cursor: number;
  jobs: Job[];
}
