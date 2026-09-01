import { ParityScriptType } from './script';
import {
  OneSidedScripResults,
  ParityEventType,
  ParityTestCase,
  ParityTestData,
  TestCaseEvaluationResult,
} from './types';

export class RunnerState {
  private testCases: TestCaseState[];
  private unknown_events: { type: ParityEventType; data: ParityTestData }[] =
    [];
  private isSupported = true;
  private launched = false;

  constructor(definitions: ParityTestCase[], signal: AbortSignal) {
    this.testCases = definitions.map(
      definition => new TestCaseState(definition, signal),
    );
  }

  start() {
    this.launched = true;
    for (const testCase of this.testCases) {
      testCase.start();
    }
  }

  skipUnsupported() {
    this.isSupported = false;
  }

  producerOk(): boolean {
    for (const testCase of this.testCases) {
      const result = testCase.evaluateProducer();
      if (!result.pass) {
        return false;
      }
    }

    return true;
  }

  recordEvent(
    from: ParityScriptType,
    event_type: ParityEventType,
    data: ParityTestData,
  ) {
    const test_case = this.testCases.find(
      tc => tc.definition.id === data.test_id,
    );
    if (!test_case) {
      this.unknown_events.push({ type: event_type, data });
      return;
    }

    test_case.recordEvent(from, event_type, data);
  }

  async evaluateResults(title: string): Promise<OneSidedScripResults> {
    if (!this.isSupported || !this.launched) {
      return {
        launched: this.launched,
        isSupported: this.isSupported,
        caseResults: [],
        unknownEvents: 0,
      };
    }

    let failed = 0;
    const caseResults = await Promise.all(
      this.testCases.map(tc => tc.evaluateResults(title)),
    );

    const log_lines: string[] = [];
    for (let i = 0; i < this.testCases.length; i++) {
      const result = caseResults[i];
      const testCase = this.testCases[i];

      if (!result.pass) {
        failed++;
      }

      const symbol = result.pass ? '✓' : 'Ｘ';
      log_lines.push(
        `  ${symbol} ${testCase.definition.name}(${testCase.definition.id})`,
        ...result.issues.map(issue => `    - ${issue}`),
      );
    }

    const passed = failed === 0 && this.unknown_events.length === 0;

    console.log(`${passed ? '✓' : 'Ｘ'} ${title}\n${log_lines.join('\n')}`);
    if (this.unknown_events.length > 0) {
      console.log(
        `${title} UNIDENTIFIED_EVENTS - received ${this.unknown_events.length} that didn't match any test-case`,
        this.unknown_events,
      );
    }

    return {
      caseResults,
      launched: this.launched,
      isSupported: this.isSupported,
      unknownEvents: this.unknown_events.length,
    };
  }
}

class TestCaseState {
  private jobs: TestCaseJobState[];
  private unknown_events: { type: ParityEventType; data: ParityTestData }[] =
    [];
  private processingTimer?: Promise<void>;
  private done = false;

  constructor(
    public definition: ParityTestCase,
    private signal: AbortSignal,
  ) {
    this.jobs = new Array(definition.job.count)
      .fill(null)
      .map((_, index) => new TestCaseJobState(`job-${index}`));
  }

  start() {
    this.processingTimer = new Promise<void>(resolve => {
      const finalize = () => {
        if (this.done) {
          return;
        }
        this.done = true;
        resolve();
      };

      const test_time =
        this.definition.outcomes.wait_time.max +
        this.definition.outcomes.processing_time.max;

      const timeout = setTimeout(finalize, test_time);

      this.signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        finalize();
      });
    });
  }

  getJob(name: string) {
    return this.jobs.find(job => job.name === name);
  }

  recordEvent(
    from: ParityScriptType,
    event_type: ParityEventType,
    data: ParityTestData,
  ) {
    if (this.done) {
      return;
    }

    const state = this.getJob(data.job_name);
    const is_consumer_event = ['job-started', 'job-completed'].includes(
      event_type,
    );
    const is_producer_event = event_type === 'job-created';

    if (
      !state ||
      (is_producer_event && from === 'consumer') ||
      (is_consumer_event && from === 'producer')
    ) {
      this.unknown_events.push({ type: event_type, data });
      return;
    }

    switch (event_type) {
      case 'job-created':
        state.recordCreation(data);
        break;
      case 'job-started':
        state.recordStart(data);
        break;
      case 'job-completed':
        state.recordCompletion(data);
        break;
    }
  }

  // Checks producer specific outcomes only to allow for early test exits
  evaluateProducer(): TestCaseEvaluationResult {
    const issues: string[] = [];

    for (const job of this.jobs) {
      if (job.createEvents.length !== 1) {
        issues.push(
          `expected ${job.name} to be created once, found ${job.createEvents.length} create events`,
        );
      }
    }
    if (issues.length > 0) {
      return {
        pass: false,
        issues,
      };
    }

    if (new Set(this.jobs.map(job => job.createEvent().test_secret)).size > 1) {
      return {
        pass: false,
        issues: ['test created jobs with multiple test secrets'],
      };
    }

    if (
      new Set(this.jobs.map(job => job.createEvent().job_secret)).size !==
      this.definition.job.count
    ) {
      return {
        pass: false,
        issues: ['expected each job to have a unique job secret'],
      };
    }

    return {
      pass: true,
      issues: [],
    };
  }

  async evaluateResults(title: string): Promise<TestCaseEvaluationResult> {
    await this.processingTimer;

    // Producer events don't depend on the timer
    const producer_result = this.evaluateProducer();
    if (!producer_result.pass) {
      return producer_result;
    }

    const exec_counts = this.definition.outcomes.exec_counts;
    const issues: string[] = [];
    for (const job_state of this.jobs) {
      // Start counts must match
      if (job_state.startEvents.length !== exec_counts.start) {
        issues.push(
          `${job_state.name}: started ${job_state.startEvents.length}/${exec_counts.start} times`,
        );
        continue;
      }

      // Completion counts must match
      if (job_state.completeEvents.length !== exec_counts.complete) {
        issues.push(
          `${job_state.name}: completed ${job_state.completeEvents.length}/${exec_counts.complete} times`,
        );
        continue;
      }

      if (!job_state.checkSecretsMatch()) {
        issues.push(
          `${job_state.name}: secrets mismatch between create and start/complete events`,
        );
      }
    }

    if (issues.length > 0) {
      // Only log the first 5 reasons ignoring the rest
      return {
        pass: false,
        issues,
      };
    }

    const definition = this.definition;

    const first_create = Math.min(...this.jobs.map(js => js.createTs()));
    const first_start = Math.min(...this.jobs.map(js => js.startTs()));

    const wait = first_start - first_create;
    const { min: wait_min, max: wait_max } = definition.outcomes.wait_time;
    // Due to differences in timestamp handling accross languages, allow a variance of up to 50ms
    if (wait < wait_min - 50 || wait > wait_max + 50) {
      return {
        pass: false,
        issues: [
          `wait time out of bounds ${wait_min} !<= ${wait} !<= ${wait_max}`,
        ],
      };
    }

    const last_completion = Math.max(...this.jobs.map(js => js.completeTs()));
    const processing = last_completion - first_start;
    const { min: processing_min, max: processing_max } =
      definition.outcomes.processing_time;
    if (processing < processing_min || processing > processing_max) {
      return {
        pass: false,
        issues: [
          `processing time out of bounds ${processing_min} !<= ${processing} !<= ${processing_max}`,
        ],
      };
    }

    const unknown_events = this.unknown_events;

    if (unknown_events.length > 0) {
      console.warn(
        `${title} UNIDENTIFIED_EVENTS<${definition.id}> - received ${unknown_events.length} that didn't match any job`,
        unknown_events,
      );

      return {
        pass: false,
        issues: [`received ${unknown_events.length} that didn't match any job`],
      };
    }

    return {
      pass: true,
      issues: [],
    };
  }
}

class TestCaseJobState {
  createEvents: ParityTestData[] = [];
  startEvents: ParityTestData[] = [];
  completeEvents: ParityTestData[] = [];

  constructor(public name: string) {}

  recordCreation(data: ParityTestData) {
    this.createEvents.push(data);
  }

  recordStart(data: ParityTestData) {
    this.startEvents.push(data);
  }

  recordCompletion(data: ParityTestData) {
    this.completeEvents.push(data);
  }

  checkSecretsMatch(): boolean {
    const createEvent = this.createEvent();
    if (!createEvent) {
      return false;
    }

    for (const event of this.startEvents) {
      if (
        event.job_secret !== createEvent.job_secret ||
        event.test_secret !== createEvent.test_secret
      ) {
        return false;
      }
    }
    return true;
  }

  createEvent(): ParityTestData {
    return this.createEvents[0];
  }

  // --------- By the time these functions are called, counts should already be verified as non-null ------
  createTs(): number {
    return this.createEvent().timestamp;
  }

  startTs(): number {
    return Math.min(...this.startEvents.map(event => event.timestamp));
  }

  completeTs(): number {
    if (!this.completeEvents.length) {
      return Math.max(...this.startEvents.map(event => event.timestamp));
    }

    return Math.max(...this.completeEvents.map(event => event.timestamp));
  }
}
