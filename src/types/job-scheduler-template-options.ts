import { JobsOptions } from './job-options';

export type JobSchedulerTemplateOptions = Omit<
  JobsOptions,
  'jobId' | 'repeat' | 'delay' | 'deduplication' | 'debounce'
>;
