import { TestReportBuilder } from './report';
import { RunCommandAs } from './script';
import {
  ParityEventType,
  ParityTestCase,
  ParityTestData,
  TestCaseEvaluationResult,
} from './types';

export class RunnerState {
  private testCases: TestCaseState[];
  private unknown_events: { type: ParityEventType; data: ParityTestData }[] =
    [];

  constructor(definitions: ParityTestCase[]) {
    this.testCases = definitions.map(
      definition => new TestCaseState(definition),
    );
  }

  start() {
    for (const testCase of this.testCases) {
      testCase.start();
    }
  }

  abort() {
    for (const testCase of this.testCases) {
      testCase.abort();
    }
  }

  producerOk(): boolean {
    for (const testCase of this.testCases) {
      const result = testCase.evaluateProducer();
      if (result.status === 'failure') {
        return false;
      }
    }

    return true;
  }

  recordEvent(
    from: RunCommandAs,
    event_type: ParityEventType,
    data: ParityTestData,
  ) {
    const test_case = this.testCases.find(
      tc => tc.definition.id === data.test_id,
    );
    if (!test_case) {
      this.unknown_events.push({ type: event_type, data });
      this.abort();
      return;
    }

    test_case.recordEvent(from, event_type, data);
  }

  async evaluateAndReport(title: string): Promise<boolean> {
    const report = new TestReportBuilder(title);

    let failed = 0;
    const per_case_results = await Promise.all(
      this.testCases.map(tc => tc.evaluateResults(title)),
    );

    const log_lines: string[] = [];
    for (let i = 0; i < this.testCases.length; i++) {
      const result = per_case_results[i];
      const testCase = this.testCases[i];

      if (result.status === 'failure') {
        failed++;
      }

      report.addResult(testCase.definition, result);
      const symbol = result.status === 'success' ? '✓' : 'Ｘ';
      log_lines.push(
        `  ${symbol} ${testCase.definition.title} - ${result.comment}`,
      );
    }

    const passed = failed === 0 && this.unknown_events.length === 0;
    const comments = [];

    const pass_count = this.testCases.length - failed;
    const message = `${pass_count}/${this.testCases.length} tests passed parity check`;

    if (this.unknown_events.length > 0) {
      console.log(
        `${title} UNIDENTIFIED_EVENTS - received ${this.unknown_events.length} that didn't match any test-case`,
        this.unknown_events,
      );
      comments.push(
        `Received ${this.unknown_events.length} that didn't match any test-case`,
      );
    }

    await report.buildAndWrite(passed, message, comments);

    console.log(`${passed ? '✅' : '❌'} ${title}\n${log_lines.join('\n')}`);
    return passed;
  }
}

class TestCaseState {
  private jobs: TestCaseJobState[];
  private unknown_events: { type: ParityEventType; data: ParityTestData }[] =
    [];
  private processingTimer?: Promise<void>;
  private done = false;
  private controller: AbortController = new AbortController();

  constructor(public definition: ParityTestCase) {
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

      const timeout = setTimeout(() => finalize, test_time);

      this.controller.signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        finalize();
      });
    });
  }

  abort() {
    this.controller.abort();
  }

  getJob(name: string) {
    return this.jobs.find(job => job.name === name);
  }

  recordEvent(
    from: RunCommandAs,
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
      this.abort();
      return;
    }

    let stillValid = false;
    switch (event_type) {
      case 'job-created':
        stillValid = state.recordCreation(data);
        break;
      case 'job-started':
        stillValid = state.recordStart(data);
        break;
      case 'job-completed':
        stillValid = state.recordCompletion(data);
        break;
    }

    if (!stillValid) {
      this.abort();
    }
  }

  // Checks producer specific outcomes only to allow for early test exits
  evaluateProducer(): TestCaseEvaluationResult {
    for (const job of this.jobs) {
      if (job.createEvents.length !== 1) {
        return {
          status: 'failure',
          comment: `expected ${job.name} to be created once, found ${job.createEvents.length} create events`,
        };
      }
    }

    if (new Set(this.jobs.map(job => job.createEvent().test_secret)).size > 1) {
      return {
        status: 'failure',
        comment: 'test created jobs with multiple test secrets',
      };
    }

    if (
      new Set(this.jobs.map(job => job.createEvent().job_secret)).size !==
      this.definition.job.count
    ) {
      return {
        status: 'failure',
        comment: 'expected each job to have a unique job secret',
      };
    }

    return {
      status: 'success',
      comment: 'Producer Passed',
    };
  }

  async evaluateResults(title: string): Promise<TestCaseEvaluationResult> {
    await this.processingTimer;

    // Producer events don't depend on the timer
    const producer_result = this.evaluateProducer();
    if (producer_result.status === 'failure') {
      return producer_result;
    }

    const exec_counts = this.definition.outcomes.exec_counts;
    const failure_reasons: string[] = [];
    for (const job_state of this.jobs) {
      // Start counts must match
      if (job_state.startEvents.length !== exec_counts.start) {
        failure_reasons.push(
          `${job_state.name}: started ${job_state.startEvents.length}/${exec_counts.start} times`,
        );
        continue;
      }

      // Completion counts must match
      if (job_state.completeEvents.length !== exec_counts.complete) {
        failure_reasons.push(
          `${job_state.name}: completed ${job_state.completeEvents.length}/${exec_counts.complete} times`,
        );
        continue;
      }

      if (!job_state.checkSecretsMatch()) {
        failure_reasons.push(
          `${job_state.name}: secrets mismatch between create and start/complete events`,
        );
      }
    }

    if (failure_reasons.length > 0) {
      // Only log the first 5 reasons ignoring the rest
      return {
        status: 'failure',
        comment: failure_reasons.splice(0, 5).join(', '),
      };
    }

    const definition = this.definition;

    const first_create = Math.min(...this.jobs.map(js => js.createTs()));
    const first_start = Math.min(...this.jobs.map(js => js.startTs()));

    const wait = first_start - first_create;
    const { min: wait_min, max: wait_max } = definition.outcomes.wait_time;
    if (wait < wait_min || wait > wait_max) {
      return {
        status: 'failure',
        comment: `wait time out of bounds ${wait_min} !<= ${wait} !<= ${wait_max}`,
      };
    }

    const last_completion = Math.max(...this.jobs.map(js => js.completeTs()));
    const processing = last_completion - first_start;
    const { min: processing_min, max: processing_max } =
      definition.outcomes.processing_time;
    if (processing < processing_min || processing > processing_max) {
      return {
        status: 'failure',
        comment: `processing time out of bounds ${processing_min} !<= ${processing} !<= ${processing_max}`,
      };
    }

    const unknown_events = this.unknown_events;

    if (unknown_events.length > 0) {
      console.warn(
        `${title} UNIDENTIFIED_EVENTS<${definition.id}> - received ${unknown_events.length} that didn't match any job`,
        unknown_events,
      );

      return {
        status: 'failure',
        comment: `received ${unknown_events.length} that didn't match any job`,
      };
    }

    return {
      status: 'success',
      comment: 'Test Passed',
    };
  }
}

class TestCaseJobState {
  createEvents: ParityTestData[] = [];
  startEvents: ParityTestData[] = [];
  completeEvents: ParityTestData[] = [];

  constructor(public name: string) {}

  recordCreation(data: ParityTestData): boolean {
    this.createEvents.push(data);

    return this.createEvents.length === 1;
  }

  recordStart(data: ParityTestData): boolean {
    this.startEvents.push(data);
    return this.checkSecretsMatch();
  }

  recordCompletion(data: ParityTestData): boolean {
    this.completeEvents.push(data);
    return this.checkSecretsMatch();
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
