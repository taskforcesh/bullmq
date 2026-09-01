export interface ParityTestCase {
  id: string;
  name: string;
  description: string;
  job: {
    count: number;
    delay?: number;
  };
  worker: {
    concurrency: number;
  };
  simulation: {
    sleep?: number;
    fail?: number;
  };
  outcomes: {
    // The minimum and maximum amount of time expected between the producer registering
    // the **first create event** and the consumer registering the **first start event**.
    wait_time: {
      min: number;
      max: number;
    };
    // The minimum and maximum amount of time expected for the consumer to complete all the jobs.
    processing_time: {
      min: number;
      max: number;
    };
    // The number of times each job is triggered and completed.
    exec_counts: {
      start: number;
      complete: number;
    };
  };
}

export const PARITY_EVENT_TYPES = [
  'job-created',
  'job-started',
  'job-completed',
  'ready',
  'not-supported', // Emitted when a backend is not supported by a specific port
] as const;
export type ParityEventType = (typeof PARITY_EVENT_TYPES)[number];

export interface ParityEvent {
  type: ParityEventType;
  run_id: string;
  data: ParityTestData;
}

export interface ParityTestData {
  timestamp: number;
  test_id: string;
  job_name: string;
  test_secret: string;
  job_secret: string;
}

export interface TestCaseEvaluationResult {
  pass: boolean;
  issues: string[];
}

export interface OneSidedScripResults {
  launched: boolean;
  isSupported: boolean;
  caseResults: TestCaseEvaluationResult[];
  unknownEvents: number;
}
