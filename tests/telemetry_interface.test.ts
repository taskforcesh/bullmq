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
import { FlowProducer, Job, JobScheduler, Queue, Worker } from '../src/classes';
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
} from '../src/interfaces';
import * as sinon from 'sinon';
import { SpanKind, TelemetryAttributes } from '../src/enums';

describe('Telemetry', () => {
  type ExtendedException = Exception & {
    message: string;
  };

  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  class MockTelemetry<Context = any> implements Telemetry<Context> {
    public tracer: Tracer<Context>;
    public contextManager: ContextManager<Context>;

    constructor(name: string) {
      this.tracer = new MockTracer();
      this.contextManager = new MockContextManager();
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

  let telemetryClient;

  let queue: Queue;
  let queueName: string;

  let connection;
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
});
