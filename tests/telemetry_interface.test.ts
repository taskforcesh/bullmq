import { default as IORedis } from 'ioredis';
import {
  describe,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  it,
  expect,
} from 'vitest';

import { v4 } from 'uuid';
import { FlowProducer, JobScheduler, Queue, Worker } from '../src/classes';
import { removeAllQueueData } from '../src/utils';
import {
  Telemetry,
  ContextManager,
  Tracer,
  Span,
  SpanOptions,
  Attributes,
  Exception,
  Time,
  Meter,
  Counter,
  Histogram,
  MetricOptions,
} from '../src/interfaces';
import * as sinon from 'sinon';
import { SpanKind, TelemetryAttributes, MetricNames } from '../src/enums';

describe('Telemetry', () => {
  type ExtendedException = Exception & {
    message: string;
  };

  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  class MockCounter implements Counter {
    public values: { value: number; attributes?: Attributes }[] = [];

    add(value: number, attributes?: Attributes): void {
      this.values.push({ value, attributes });
    }
  }

  class MockHistogram implements Histogram {
    public values: { value: number; attributes?: Attributes }[] = [];

    record(value: number, attributes?: Attributes): void {
      this.values.push({ value, attributes });
    }
  }

  class MockMeter implements Meter {
    public counters: Map<string, MockCounter> = new Map();
    public histograms: Map<string, MockHistogram> = new Map();

    createCounter(name: string, options?: MetricOptions): Counter {
      let counter = this.counters.get(name);
      if (!counter) {
        counter = new MockCounter();
        this.counters.set(name, counter);
      }
      return counter;
    }

    createHistogram(name: string, options?: MetricOptions): Histogram {
      let histogram = this.histograms.get(name);
      if (!histogram) {
        histogram = new MockHistogram();
        this.histograms.set(name, histogram);
      }
      return histogram;
    }
  }

  class MockTelemetry<Context = any> implements Telemetry<Context> {
    public tracer: Tracer<Context>;
    public contextManager: ContextManager<Context>;
    public meter?: Meter;

    constructor(name: string, enableMetrics = false) {
      this.tracer = new MockTracer();
      this.contextManager = new MockContextManager();
      if (enableMetrics) {
        this.meter = new MockMeter();
      }
    }
  }

  class MockTracer implements Tracer {
    startSpan(name: string, options?: SpanOptions): Span {
      return new MockSpan(name, options);
    }
  }

  class MockContextManager<Context = any> implements ContextManager<Context> {
    private activeContext: Context = {} as Context;

    with<A extends(...args: any[]) => any>(
      context: Context,
      fn: A,
    ): ReturnType<A> {
      this.activeContext = context;
      return fn();
    }

    active(): Context {
      return this.activeContext;
    }

    getMetadata(context: Context): string {
      if (!context) {
        return '';
      }
      const metadata: Record<string, string> = {};
      Object.keys(context as object).forEach(key => {
        if (key.startsWith('getMetadata_')) {
          const value = context[key];
          metadata[key] = value;
        }
      });
      return JSON.stringify(metadata);
    }

    fromMetadata(activeContext: Context, metadataString: string): Context {
      const newContext = { ...activeContext };
      if (metadataString) {
        const metadata = JSON.parse(metadataString);
        Object.keys(metadata).forEach(key => {
          newContext[key] = () => metadata[key];
        });
      }
      return newContext;
    }
  }

  class MockSpan implements Span {
    attributes: Attributes = {};
    name: string;
    options: SpanOptions | undefined;
    exception: ExtendedException | undefined;

    constructor(name: string, options?: SpanOptions) {
      this.name = name;
      this.options = options;
    }

    setSpanOnContext(ctx: any, omitContext?: boolean): any {
      ctx['getSpan'] = () => this;
      return { ...ctx, getMetadata_span: this['name'] };
    }

    addEvent(name: string, attributes?: Attributes): void {}

    setAttribute(key: string, value: any): void {
      this.attributes[key] = value;
    }

    setAttributes(attributes: Attributes): void {
      this.attributes = { ...this.attributes, ...attributes };
    }

    recordException(exception: ExtendedException, time?: Time): void {
      this.exception = exception;
    }

    end(): void {}
  }

  let telemetryClient: MockTelemetry;

  let queue: Queue;
  let queueName: string;

  let connection: IORedis;
  beforeAll(async () => {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async () => {
    queueName = `test-${v4()}`;
    telemetryClient = new MockTelemetry('mockTracer');

    queue = new Queue(queueName, {
      connection,
      prefix,
      telemetry: telemetryClient,
    });
  });

  afterEach(async () => {
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  afterAll(async () => {
    await connection.quit();
  });

  describe('Queue.add', () => {
    it('should correctly interact with telemetry when adding a job', async () => {
      await queue.add('testJob', { foo: 'bar' });

      const activeContext = telemetryClient.contextManager.active();

      const span = activeContext.getSpan?.() as MockSpan;
      expect(span).toBeInstanceOf(MockSpan);
      expect(span.name).toBe(`add ${queueName}.testJob`);
      expect(span.options?.kind).toBe(SpanKind.PRODUCER);
      expect(span.attributes[TelemetryAttributes.QueueName]).toBe(queueName);
    });

    it('should correctly handle errors and record them in telemetry', async () => {
      const opts = {
        repeat: {
          endDate: 1,
        },
      };

      const recordExceptionSpy = sinon.spy(
        MockSpan.prototype,
        'recordException',
      );

      try {
        await queue.add('testJob', { someData: 'testData' }, opts);
      } catch (e) {
        expect(recordExceptionSpy.calledOnce).toBe(true);
        const recordedError = recordExceptionSpy.firstCall.args[0];
        expect(recordedError.message).toBe(
          'End date must be greater than current timestamp',
        );
      } finally {
        recordExceptionSpy.restore();
      }
    });
  });

  describe('Queue.addBulk', () => {
    it('should correctly interact with telemetry when adding multiple jobs', async () => {
      const jobs = [
        { name: 'job1', data: { foo: 'bar' } },
        { name: 'job2', data: { baz: 'qux' } },
      ];

      await queue.addBulk(jobs);

      const activeContext = telemetryClient.contextManager.active();
      const span = activeContext.getSpan?.() as MockSpan;
      expect(span).toBeInstanceOf(MockSpan);
      expect(span.name).toBe(`addBulk ${queueName}`);
      expect(span.options?.kind).toBe(SpanKind.PRODUCER);
      expect(span.attributes[TelemetryAttributes.BulkNames]).toEqual(
        jobs.map(job => job.name),
      );
      expect(span.attributes[TelemetryAttributes.BulkCount]).toBe(jobs.length);
    });

    it('should correctly handle errors and record them in telemetry for addBulk', async () => {
      const recordExceptionSpy = sinon.spy(
        MockSpan.prototype,
        'recordException',
      );

      try {
        await queue.addBulk([
          { name: 'testJob1', data: { someData: 'testData1' } },
          {
            name: 'testJob2',
            data: { someData: 'testData2' },
            opts: { jobId: '0' },
          },
        ]);
      } catch (e) {
        expect(recordExceptionSpy.calledOnce).toBe(true);
        const recordedError = recordExceptionSpy.firstCall.args[0];
        expect(recordedError.message).toBe('Custom Id cannot be integers');
      } finally {
        recordExceptionSpy.restore();
      }
    });
  });

  describe('Queue.upsertJobScheduler', async () => {
    it('should correctly interact with telemetry when adding a job scheduler', async () => {
      const jobSchedulerId = 'testJobScheduler';
      const data = { foo: 'bar' };

      await queue.upsertJobScheduler(
        jobSchedulerId,
        { every: 1000, endDate: Date.now() + 1000 },
        { name: 'repeatable-job', data },
      );

      const activeContext = telemetryClient.contextManager.active();
      const span = activeContext.getSpan?.() as MockSpan;
      expect(span).toBeInstanceOf(MockSpan);
      expect(span.name).toBe(`add ${queueName}.repeatable-job`);
      expect(span.options?.kind).toBe(SpanKind.PRODUCER);
      expect(span.attributes[TelemetryAttributes.JobSchedulerId]).toBe(
        jobSchedulerId,
      );
      expect(span.attributes[TelemetryAttributes.JobId]).toBeTypeOf('string');
      expect(span.attributes[TelemetryAttributes.JobId]).toContain(
        `repeat:${jobSchedulerId}:`,
      );
    });

    it('should correctly handle errors and record them in telemetry for upsertJobScheduler', async () => {
      const originalCreateNextJob = JobScheduler.prototype.createNextJob;
      const recordExceptionSpy = sinon.spy(
        MockSpan.prototype,
        'recordException',
      );

      const errMessage = 'Error creating job';

      // Force an exception on the job schedulers private method createNextJob
      (<any>JobScheduler).prototype.createNextJob = () => {
        throw new Error(errMessage);
      };

      try {
        await queue.upsertJobScheduler(
          'testJobScheduler',
          { every: 1000 },
          { data: { foo: 'bar' } },
        );
      } catch (e) {
        expect(recordExceptionSpy.calledOnce).toBe(true);
        const recordedError = recordExceptionSpy.firstCall.args[0];
        expect(recordedError.message).toBe(errMessage);
      } finally {
        JobScheduler.prototype.createNextJob = originalCreateNextJob;
        recordExceptionSpy.restore();
      }
    });
  });

  describe('Worker.processJob', async () => {
    it('should correctly interact with telemetry when processing a job', async () => {
      const job = await queue.add('testJob', { foo: 'bar' });

      const worker = new Worker(queueName, async () => 'some result', {
        connection,
        telemetry: telemetryClient,
        name: 'testWorker',
        prefix,
      });

      await worker.waitUntilReady();
      const moveToCompletedStub = sinon.stub(job, 'moveToCompleted').resolves();

      const startSpanSpy = sinon.spy(telemetryClient.tracer, 'startSpan');

      const token = 'some-token';

      await worker.processJob(job, token, () => false, new Set());

      const span = startSpanSpy.returnValues[0] as MockSpan;

      expect(span).toBeInstanceOf(MockSpan);
      expect(span.name).toBe(`process ${queueName}`);
      expect(span.options?.kind).toBe(SpanKind.CONSUMER);
      expect(span.attributes[TelemetryAttributes.WorkerId]).toBe(worker.id);
      expect(span.attributes[TelemetryAttributes.WorkerName]).toBe(
        'testWorker',
      );
      expect(span.attributes[TelemetryAttributes.JobId]).toBe(job.id);

      moveToCompletedStub.restore();
      await worker.close();
    });

    it('should propagate context correctly between queue and worker using telemetry', async () => {
      const job = await queue.add('testJob', { foo: 'bar' });

      const worker = new Worker(queueName, async () => 'some result', {
        connection,
        telemetry: telemetryClient,
        prefix,
      });
      await worker.waitUntilReady();

      const moveToCompletedStub = sinon.stub(job, 'moveToCompleted').resolves();

      await worker.processJob(job, 'some-token', () => false, new Set());

      const workerActiveContext = telemetryClient.contextManager.active();
      const queueActiveContext = telemetryClient.contextManager.active();
      expect(workerActiveContext).toBe(queueActiveContext);

      moveToCompletedStub.restore();
      await worker.close();
    });

    it('should set timestamp attributes when job processing completes', async () => {
      const job = await queue.add('testJob', { foo: 'bar' });

      const worker = new Worker(queueName, async () => 'some result', {
        connection,
        telemetry: telemetryClient,
        name: 'testWorker',
        prefix,
      });

      await worker.waitUntilReady();
      const moveToCompletedStub = sinon.stub(job, 'moveToCompleted').resolves();

      const startSpanSpy = sinon.spy(telemetryClient.tracer, 'startSpan');

      job.processedOn = Date.now();
      await worker.processJob(job, 'some-token', () => false);

      const span = startSpanSpy.returnValues[0] as MockSpan;

      // Verify timestamp attributes are set in the finally block
      expect(
        span.attributes[TelemetryAttributes.JobFinishedTimestamp],
      ).toBeDefined();
      expect(
        span.attributes[TelemetryAttributes.JobAttemptFinishedTimestamp],
      ).toBeDefined();
      expect(
        span.attributes[TelemetryAttributes.JobProcessedTimestamp],
      ).toBeDefined();

      // JobFinishedTimestamp should be a recent timestamp
      const jobFinishedTimestamp =
        span.attributes[TelemetryAttributes.JobFinishedTimestamp];
      expect(typeof jobFinishedTimestamp).toBe('number');
      expect(jobFinishedTimestamp).toBeGreaterThan(Date.now() - 10000);

      startSpanSpy.restore();
      moveToCompletedStub.restore();
      await worker.close();
    });

    it('should set job attempts attribute on successful completion', async () => {
      const job = await queue.add('testJob', { foo: 'bar' });

      const worker = new Worker(queueName, async () => 'completed result', {
        connection,
        telemetry: telemetryClient,
        name: 'testWorker',
        prefix,
      });

      await worker.waitUntilReady();
      const moveToCompletedStub = sinon.stub(job, 'moveToCompleted').resolves();

      const startSpanSpy = sinon.spy(telemetryClient.tracer, 'startSpan');

      await worker.processJob(job, 'some-token', () => false);

      const span = startSpanSpy.returnValues[0] as MockSpan;

      // handleCompleted should set JobAttemptsMade
      expect(
        span.attributes[TelemetryAttributes.JobAttemptsMade],
      ).toBeDefined();

      startSpanSpy.restore();
      moveToCompletedStub.restore();
      await worker.close();
    });

    it('should set job failed reason attribute on failure', async () => {
      const errorMessage = 'Test processing error';
      const job = await queue.add('testJob', { foo: 'bar' });

      const worker = new Worker<any, any, string>(
        queueName,
        async () => {
          throw new Error(errorMessage);
        },
        {
          connection,
          telemetry: telemetryClient,
          name: 'testWorker',
          prefix,
        },
      );

      await worker.waitUntilReady();
      const moveToFailedStub = sinon.stub(job, 'moveToFailed').resolves();

      const startSpanSpy = sinon.spy(telemetryClient.tracer, 'startSpan');
      const addEventSpy = sinon.spy(MockSpan.prototype, 'addEvent');

      await worker.processJob(job, 'some-token', () => false);

      const span = startSpanSpy.returnValues[0] as MockSpan;

      // handleFailed should add event with JobFailedReason
      const failedEventCall = addEventSpy
        .getCalls()
        .find(call => call.args[0] === 'job failed');
      expect(failedEventCall).toBeDefined();
      expect(
        failedEventCall?.args[1]?.[TelemetryAttributes.JobFailedReason],
      ).toBe(errorMessage);

      // handleFailed should set JobAttemptsMade
      expect(
        span.attributes[TelemetryAttributes.JobAttemptsMade],
      ).toBeDefined();

      addEventSpy.restore();
      startSpanSpy.restore();
      moveToFailedStub.restore();
      await worker.close();
    });
  });

  describe('Flows', () => {
    it('should correctly interact with telemetry when adding a flow', async () => {
      const flowProducer = new FlowProducer({
        connection,
        telemetry: telemetryClient,
        prefix,
      });

      const traceSpy = sinon.spy(telemetryClient.tracer, 'startSpan');
      const testFlow = {
        name: 'parentJob',
        queueName,
        prefix,
        data: { foo: 'bar' },
        children: [
          {
            name: 'childJob',
            queueName,
            prefix,
            data: { baz: 'qux' },
          },
        ],
      };

      const jobNode = await flowProducer.add(testFlow);
      const parentJob = jobNode.job;

      const span = traceSpy.returnValues[0] as MockSpan;

      expect(span).toBeInstanceOf(MockSpan);
      expect(span.name).toBe(`addFlow ${queueName}`);
      expect(span.options?.kind).toBe(SpanKind.PRODUCER);
      expect(span.attributes[TelemetryAttributes.FlowName]).toBe(testFlow.name);

      traceSpy.restore();
      await flowProducer.close();
    });

    it('should correctly handle errors and record them in telemetry for flows', async () => {
      const flowProducer = new FlowProducer({
        connection,
        telemetry: telemetryClient,
        prefix,
      });

      const traceSpy = sinon.spy(telemetryClient.tracer, 'startSpan');
      const recordExceptionSpy = sinon.spy(
        MockSpan.prototype,
        'recordException',
      );

      try {
        await flowProducer.add({
          name: 'errorJob',
          queueName,
          data: { foo: 'bar' },
          opts: { parent: { id: 'invalidParentId', queue: 'invalidQueue' } },
        });
      } catch (e) {
        expect(recordExceptionSpy.calledOnce).toBe(true);
        const recordedError = recordExceptionSpy.firstCall.args[0];
        expect(recordedError.message).toBe(
          'Failed to add flow due to invalid parent configuration',
        );
      } finally {
        traceSpy.restore();
        recordExceptionSpy.restore();
        await flowProducer.close();
      }
    });
  });

  describe('Flows - addBulk', () => {
    it('should correctly interact with telemetry when adding multiple flows', async () => {
      const flowProducer = new FlowProducer({
        connection,
        telemetry: telemetryClient,
        prefix,
      });

      const traceSpy = sinon.spy(telemetryClient.tracer, 'startSpan');
      const testFlows = [
        {
          name: 'parentJob1',
          queueName,
          data: { foo: 'bar1' },
          children: [
            {
              name: 'childJob1',
              queueName,
              data: { baz: 'qux1' },
            },
          ],
        },
        {
          name: 'parentJob2',
          queueName,
          data: { foo: 'bar2' },
          children: [
            {
              name: 'childJob2',
              queueName,
              data: { baz: 'qux2' },
            },
          ],
        },
      ];

      const jobNodes = await flowProducer.addBulk(testFlows);

      const span = traceSpy.returnValues[0] as MockSpan;

      expect(span).toBeInstanceOf(MockSpan);
      expect(span.name).toBe('addBulkFlows');
      expect(span.options?.kind).toBe(SpanKind.PRODUCER);
      expect(span.attributes[TelemetryAttributes.BulkNames]).toBe(
        testFlows.map(flow => flow.name).join(','),
      );
      expect(span.attributes[TelemetryAttributes.BulkCount]).toBe(
        testFlows.length,
      );

      traceSpy.restore();
      await flowProducer.close();
    });

    it('should correctly handle errors and record them in telemetry for addBulk', async () => {
      const flowProducer = new FlowProducer({
        connection,
        telemetry: telemetryClient,
        prefix,
      });

      const traceSpy = sinon.spy(telemetryClient.tracer, 'startSpan');
      const recordExceptionSpy = sinon.spy(
        MockSpan.prototype,
        'recordException',
      );

      const invalidFlows = [
        {
          name: 'errorJob1',
          queueName,
          data: { foo: 'bar1' },
          opts: { parent: { id: 'invalidParentId', queue: 'invalidQueue' } },
        },
        {
          name: 'errorJob2',
          queueName,
          data: { foo: 'bar2' },
          opts: { parent: { id: 'invalidParentId', queue: 'invalidQueue' } },
        },
      ];

      try {
        await flowProducer.addBulk(invalidFlows);
      } catch (e) {
        expect(recordExceptionSpy.calledOnce).toBe(true);
        const recordedError = recordExceptionSpy.firstCall.args[0];
        expect(recordedError.message).toBe(
          'Failed to add bulk flows due to invalid parent configuration',
        );
      } finally {
        traceSpy.restore();
        recordExceptionSpy.restore();
        await flowProducer.close();
      }
    });
  });

  describe('Omit Propagation', () => {
    let fromMetadataSpy;

    beforeEach(() => {
      fromMetadataSpy = sinon.spy(
        telemetryClient.contextManager,
        'fromMetadata',
      );
    });

    afterEach(() => fromMetadataSpy.restore());

    it('should omit propagation on queue add', async () => {
      let worker;
      const processing = new Promise<void>(resolve => {
        worker = new Worker(queueName, async () => resolve(), {
          connection,
          telemetry: telemetryClient,
          prefix,
        });
      });

      const job = await queue.add(
        'testJob',
        { foo: 'bar' },
        { telemetry: { omitContext: true } },
      );

      await processing;

      expect(fromMetadataSpy.callCount).toBe(0);
      await worker.close();
    });

    it('should omit propagation on queue addBulk', async () => {
      let worker;
      const processing = new Promise<void>(resolve => {
        worker = new Worker(queueName, async () => resolve(), {
          connection,
          telemetry: telemetryClient,
          prefix,
        });
      });

      const jobs = [
        {
          name: 'job1',
          data: { foo: 'bar' },
          opts: { telemetry: { omitContext: true } },
        },
      ];
      const addedJos = await queue.addBulk(jobs);
      expect(addedJos).toHaveLength(1);

      await processing;

      expect(fromMetadataSpy.callCount).toBe(0);
      await worker.close();
    });

    it('should omit propagation on job scheduler', async () => {
      let worker;
      const processing = new Promise<void>(resolve => {
        worker = new Worker(queueName, async () => resolve(), {
          connection,
          telemetry: telemetryClient,
          prefix,
        });
      });

      const jobSchedulerId = 'testJobScheduler';
      const data = { foo: 'bar' };

      const job = await queue.upsertJobScheduler(
        jobSchedulerId,
        { every: 1000, endDate: Date.now() + 1000, limit: 1 },
        {
          name: 'repeatable-job',
          data,
          opts: { telemetry: { omitContext: true } },
        },
      );

      await processing;

      expect(fromMetadataSpy.callCount).toBe(0);
      await worker.close();
    });

    it('should omit propagation on flow producer', async () => {
      let worker;
      const processing = new Promise<void>(resolve => {
        worker = new Worker(queueName, async () => resolve(), {
          connection,
          telemetry: telemetryClient,
          prefix,
        });
      });

      const flowProducer = new FlowProducer({
        connection,
        telemetry: telemetryClient,
        prefix,
      });

      const testFlow = {
        name: 'parentJob',
        queueName,
        data: { foo: 'bar' },
        children: [
          {
            name: 'childJob',
            queueName,
            data: { baz: 'qux' },
            opts: { telemetry: { omitContext: true } },
          },
        ],
        opts: { telemetry: { omitContext: true } },
      };

      const jobNode = await flowProducer.add(testFlow);
      const jobs = jobNode.children
        ? [jobNode.job, ...jobNode.children.map(c => c.job)]
        : [jobNode.job];

      await processing;

      expect(fromMetadataSpy.callCount).toBe(0);
      await flowProducer.close();
      await worker.close();
    });
  });

  describe('Metrics', () => {
    let metricsTelemetryClient: MockTelemetry;
    let metricsQueue: Queue;

    beforeEach(async () => {
      metricsTelemetryClient = new MockTelemetry('mockTracer', true);
      metricsQueue = new Queue(queueName, {
        connection,
        prefix,
        telemetry: metricsTelemetryClient,
      });
    });

    afterEach(async () => {
      await metricsQueue.close();
    });

    it('should record metrics when job is completed', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          return 'completed';
        },
        {
          connection,
          prefix,
          telemetry: metricsTelemetryClient,
        },
      );

      await worker.waitUntilReady();

      await metricsQueue.add('testJob', { foo: 'bar' });

      await new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      const meter = metricsTelemetryClient.meter as MockMeter;
      expect(meter).toBeDefined();

      const completedCounter = meter.counters.get(MetricNames.JobsCompleted);
      expect(completedCounter).toBeDefined();
      expect(completedCounter!.values.length).toBeGreaterThan(0);
      expect(completedCounter!.values[0].value).toBe(1);
      expect(completedCounter!.values[0].attributes).toMatchObject({
        [TelemetryAttributes.QueueName]: queueName,
        [TelemetryAttributes.JobName]: 'testJob',
        [TelemetryAttributes.JobStatus]: 'completed',
      });

      await worker.close();
    });

    it('should record metrics when job fails', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('Job failed');
        },
        {
          connection,
          prefix,
          telemetry: metricsTelemetryClient,
        },
      );

      await worker.waitUntilReady();

      await metricsQueue.add('testJob', { foo: 'bar' });

      await new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      const meter = metricsTelemetryClient.meter as MockMeter;
      expect(meter).toBeDefined();

      const failedCounter = meter.counters.get(MetricNames.JobsFailed);
      expect(failedCounter).toBeDefined();
      expect(failedCounter!.values.length).toBeGreaterThan(0);
      expect(failedCounter!.values[0].value).toBe(1);
      expect(failedCounter!.values[0].attributes).toMatchObject({
        [TelemetryAttributes.QueueName]: queueName,
        [TelemetryAttributes.JobName]: 'testJob',
        [TelemetryAttributes.JobStatus]: 'failed',
      });

      await worker.close();
    });

    it('should record delayed metrics when job is retried with delay', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          throw new Error('Job failed');
        },
        {
          connection,
          prefix,
          telemetry: metricsTelemetryClient,
        },
      );

      await worker.waitUntilReady();

      await metricsQueue.add(
        'testJob',
        { foo: 'bar' },
        {
          attempts: 2,
          backoff: { type: 'fixed', delay: 1000 },
        },
      );

      // Wait for first attempt to fail and be delayed
      await new Promise<void>(resolve => {
        worker.on('failed', () => resolve());
      });

      const meter = metricsTelemetryClient.meter as MockMeter;
      expect(meter).toBeDefined();

      const delayedCounter = meter.counters.get(MetricNames.JobsDelayed);
      expect(delayedCounter).toBeDefined();
      expect(delayedCounter!.values.length).toBeGreaterThan(0);
      expect(delayedCounter!.values[0].value).toBe(1);
      expect(delayedCounter!.values[0].attributes).toMatchObject({
        [TelemetryAttributes.QueueName]: queueName,
        [TelemetryAttributes.JobName]: 'testJob',
        [TelemetryAttributes.JobStatus]: 'delayed',
      });

      await worker.close();
    });

    it('should record duration histogram when job completes', async () => {
      const worker = new Worker(
        queueName,
        async () => {
          // Simulate some work
          await new Promise(resolve => setTimeout(resolve, 50));
          return 'completed';
        },
        {
          connection,
          prefix,
          telemetry: metricsTelemetryClient,
        },
      );

      await worker.waitUntilReady();

      await metricsQueue.add('testJob', { foo: 'bar' });

      await new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      const meter = metricsTelemetryClient.meter as MockMeter;
      expect(meter).toBeDefined();

      const durationHistogram = meter.histograms.get(MetricNames.JobDuration);
      expect(durationHistogram).toBeDefined();
      expect(durationHistogram!.values.length).toBeGreaterThan(0);
      // Duration should be at least 50ms
      expect(durationHistogram!.values[0].value).toBeGreaterThanOrEqual(50);
      expect(durationHistogram!.values[0].attributes).toMatchObject({
        [TelemetryAttributes.QueueName]: queueName,
        [TelemetryAttributes.JobName]: 'testJob',
      });

      await worker.close();
    });

    it('should not record metrics when meter is not configured', async () => {
      // Use the original telemetryClient which doesn't have metrics enabled
      const worker = new Worker(
        queueName,
        async () => {
          return 'completed';
        },
        {
          connection,
          prefix,
          telemetry: telemetryClient,
        },
      );

      await worker.waitUntilReady();

      const job = await queue.add('testJob', { foo: 'bar' });

      await new Promise<void>(resolve => {
        worker.on('completed', () => resolve());
      });

      // telemetryClient doesn't have a meter, so no metrics should be recorded
      expect(telemetryClient.meter).toBeUndefined();

      await worker.close();
    });

    it('should cache counter and histogram instances', async () => {
      const meter = metricsTelemetryClient.meter as MockMeter;
      expect(meter).toBeDefined();

      // Create same counter twice
      const counter1 = meter.createCounter('test.counter');
      const counter2 = meter.createCounter('test.counter');
      expect(counter1).toBe(counter2);

      // Create same histogram twice
      const histogram1 = meter.createHistogram('test.histogram');
      const histogram2 = meter.createHistogram('test.histogram');
      expect(histogram1).toBe(histogram2);
    });
  });
});
