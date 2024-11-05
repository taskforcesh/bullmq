import { expect, assert } from 'chai';
import { default as IORedis } from 'ioredis';
import { after, beforeEach, describe, it, before } from 'mocha';
import { v4 } from 'uuid';
import { FlowProducer, Queue, Worker } from '../src/classes';
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

    setSpanOnContext(ctx: any): any {
      context['getSpan'] = () => this;
      return { ...context, getMetadata_span: this['name'] };
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
  before(async function () {
    connection = new IORedis(redisHost, { maxRetriesPerRequest: null });
  });

  beforeEach(async function () {
    queueName = `test-${v4()}`;
    telemetryClient = new MockTelemetry('mockTracer');

    queue = new Queue(queueName, {
      connection,
      prefix,
      telemetry: telemetryClient,
    });
  });

  afterEach(async function () {
    await queue.close();
    await removeAllQueueData(new IORedis(redisHost), queueName);
  });

  after(async function () {
    await connection.quit();
  });

  describe('Queue.add', () => {
    it('should correctly interact with telemetry when adding a job', async () => {
      await queue.add('testJob', { foo: 'bar' });

      const activeContext = telemetryClient.contextManager.active();

      const span = activeContext.getSpan?.() as MockSpan;
      expect(span).to.be.an.instanceOf(MockSpan);
      expect(span.name).to.equal(`add ${queueName}.testJob`);
      expect(span.options?.kind).to.equal(SpanKind.PRODUCER);
      expect(span.attributes[TelemetryAttributes.QueueName]).to.equal(
        queueName,
      );
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
        assert(recordExceptionSpy.calledOnce);
        const recordedError = recordExceptionSpy.firstCall.args[0];
        assert.equal(
          recordedError.message,
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
      expect(span).to.be.an.instanceOf(MockSpan);
      expect(span.name).to.equal(`addBulk ${queueName}`);
      expect(span.options?.kind).to.equal(SpanKind.PRODUCER);
      expect(span.attributes[TelemetryAttributes.BulkNames]).to.deep.equal(
        jobs.map(job => job.name),
      );
      expect(span.attributes[TelemetryAttributes.BulkCount]).to.equal(
        jobs.length,
      );
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
        assert(recordExceptionSpy.calledOnce);
        const recordedError = recordExceptionSpy.firstCall.args[0];
        assert.equal(recordedError.message, 'Custom Ids cannot be integers');
      } finally {
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
      });

      await worker.waitUntilReady();
      const moveToCompletedStub = sinon.stub(job, 'moveToCompleted').resolves();

      const startSpanSpy = sinon.spy(telemetryClient.tracer, 'startSpan');

      const token = 'some-token';

      await worker.processJob(job, token, () => false, new Set());

      const span = startSpanSpy.returnValues[0] as MockSpan;

      expect(span).to.be.an.instanceOf(MockSpan);
      expect(span.name).to.equal(`process ${queueName}`);
      expect(span.options?.kind).to.equal(SpanKind.CONSUMER);
      expect(span.attributes[TelemetryAttributes.WorkerId]).to.equal(worker.id);
      expect(span.attributes[TelemetryAttributes.WorkerName]).to.equal(
        'testWorker',
      );
      expect(span.attributes[TelemetryAttributes.JobId]).to.equal(job.id);

      moveToCompletedStub.restore();
      await worker.close();
    });

    it('should propagate context correctly between queue and worker using telemetry', async () => {
      const job = await queue.add('testJob', { foo: 'bar' });

      const worker = new Worker(queueName, async () => 'some result', {
        connection,
        telemetry: telemetryClient,
      });
      await worker.waitUntilReady();

      const moveToCompletedStub = sinon.stub(job, 'moveToCompleted').resolves();

      await worker.processJob(job, 'some-token', () => false, new Set());

      const workerActiveContext = telemetryClient.contextManager.active();
      const queueActiveContext = telemetryClient.contextManager.active();
      expect(workerActiveContext).to.equal(queueActiveContext);

      moveToCompletedStub.restore();
      await worker.close();
    });
  });

  describe('Flows', () => {
    it('should correctly interact with telemetry when adding a flow', async () => {
      const flowProducer = new FlowProducer({
        connection,
        telemetry: telemetryClient,
      });

      const traceSpy = sinon.spy(telemetryClient.tracer, 'startSpan');
      const testFlow = {
        name: 'parentJob',
        queueName,
        data: { foo: 'bar' },
        children: [
          {
            name: 'childJob',
            queueName,
            data: { baz: 'qux' },
          },
        ],
      };

      const jobNode = await flowProducer.add(testFlow);
      const parentJob = jobNode.job;

      const span = traceSpy.returnValues[0] as MockSpan;

      expect(span).to.be.an.instanceOf(MockSpan);
      expect(span.name).to.equal(`addFlow ${queueName}`);
      expect(span.options?.kind).to.equal(SpanKind.PRODUCER);
      expect(span.attributes[TelemetryAttributes.FlowName]).to.equal(
        testFlow.name,
      );

      traceSpy.restore();
      await flowProducer.close();
    });

    it('should correctly handle errors and record them in telemetry for flows', async () => {
      const flowProducer = new FlowProducer({
        connection,
        telemetry: telemetryClient,
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
        assert(recordExceptionSpy.calledOnce);
        const recordedError = recordExceptionSpy.firstCall.args[0];
        assert.equal(
          recordedError.message,
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

      expect(span).to.be.an.instanceOf(MockSpan);
      expect(span.name).to.equal('addBulkFlows');
      expect(span.options?.kind).to.equal(SpanKind.PRODUCER);
      expect(span.attributes[TelemetryAttributes.BulkNames]).to.equal(
        testFlows.map(flow => flow.name).join(','),
      );
      expect(span.attributes[TelemetryAttributes.BulkCount]).to.equal(
        testFlows.length,
      );

      traceSpy.restore();
      await flowProducer.close();
    });

    it('should correctly handle errors and record them in telemetry for addBulk', async () => {
      const flowProducer = new FlowProducer({
        connection,
        telemetry: telemetryClient,
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
        assert(recordExceptionSpy.calledOnce);
        const recordedError = recordExceptionSpy.firstCall.args[0];
        assert.equal(
          recordedError.message,
          'Failed to add bulk flows due to invalid parent configuration',
        );
      } finally {
        traceSpy.restore();
        recordExceptionSpy.restore();
        await flowProducer.close();
      }
    });
  });
});
