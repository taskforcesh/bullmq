import { JobSchedulerTemplateOptions } from '../types';

export interface JobSchedulerTemplateJson<D = any> {
  data?: D;
  opts?: JobSchedulerTemplateOptions;
}

export interface JobSchedulerJson<D = any> {
  key: string; // key is actually the job scheduler id
  name: string;
  id?: string | null;
  iterationCount?: number;
  limit?: number;
  endDate?: number;
  tz?: string;
  pattern?: string;
  every?: string;
  next?: number;
  template?: JobSchedulerTemplateJson<D>;
}
