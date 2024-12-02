import { JobsOptions } from '../types';

export interface JobSchedulerTemplateJson<D = any> {
  data?: D;
  opts?: Omit<JobsOptions, 'jobId' | 'repeat' | 'delay'>;
}

export interface JobSchedulerJson<D = any> {
  key: string; // key is actually the job scheduler id
  name: string;
  id?: string | null;
  endDate: number | null;
  tz: string | null;
  pattern: string | null;
  every?: string | null;
  next?: number;
  template?: JobSchedulerTemplateJson<D>;
}
