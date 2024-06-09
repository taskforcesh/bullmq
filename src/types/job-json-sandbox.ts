import { JobJson } from '../interfaces';
import { ChildrenValues } from './children-values';

export type JobJsonSandbox = JobJson & {
  queueName: string;
  prefix: string;
};

// Maybe this is unnecessary? - Also, this is not a good name :(
export type JobJsonSandBoxWithChildrenValues<T = any> = JobJsonSandbox & {
  childrenValues: ChildrenValues<T>;
};
