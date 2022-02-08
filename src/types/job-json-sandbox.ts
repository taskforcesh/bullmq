import { JobJson } from '../interfaces';

export type JobJsonSandbox = JobJson & { queueName: string };
