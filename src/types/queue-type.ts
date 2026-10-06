import type { Job } from '../classes/job';

export type ExtractDataType<DataTypeOrJob, Default> =
  DataTypeOrJob extends Job<infer D, any, any> ? D : Default;

export type ExtractResultType<DataTypeOrJob, Default> =
  DataTypeOrJob extends Job<any, infer R, any> ? R : Default;

export type ExtractNameType<DataTypeOrJob, Default extends string> =
  DataTypeOrJob extends Job<any, any, infer N> ? N : Default;
