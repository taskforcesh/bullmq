import { Queue } from '../src/classes/queue';

type JobName = 'generate-report' | 'send-email';

interface JobData {
  accountId: string;
}

const queue = new Queue<JobData, void, JobName>('issue-3937');
const dynamicId = String('inst_12345');

// Scheduler IDs must accept dynamic strings independently of the job name type.
queue.upsertJobScheduler(
  dynamicId,
  {
    every: 60_000,
  },
  {
    name: 'generate-report',
    data: {
      accountId: 'acct_12345',
    },
  },
);
