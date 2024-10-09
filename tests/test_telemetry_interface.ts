import { expect, assert } from 'chai';
import { default as IORedis } from 'ioredis';
import { after, beforeEach, describe, it, before } from 'mocha';
import { v4 } from 'uuid';
import { Queue, Worker } from '../src/classes';
import { removeAllQueueData } from '../src/utils';
import {
  Telemetry,
  Trace,
  ContextManager,
  Tracer,
  Span,
  SpanOptions,
  Attributes,
  Exception,
  Time,
  SpanContext,
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
    public trace: Trace<Span>;
    public contextManager: ContextManager<Context>;
    public tracerName: string;

    constructor(name: string) {
      this.trace = new MockTrace();
      this.contextManager = new MockContextManager();
      this.tracerName = name;
    }
  }

  class MockTrace<Span = any, Context = any> implements Trace<Span> {
    getTracer(): Tracer {
      return new MockTracer();
    }

    setSpan(context: Context, span: Span): Context {
      context['getSpan'] = () => span;
      return { ...context, getMetadata_span: span['name'] };
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

    getMetadata(context: Context): Record<string, string> {
      const metadata: Record<string, string> = {};
      Object.keys(context as object).forEach(key => {
        if (key.startsWith('getMetadata_')) {
          const value = context[key];
          metadata[key] = value;
        }
      });
      return metadata;
    }

    fromMetadata(
      activeContext: Context,
      metadata: Record<string, string>,
    ): Context {
      const newContext = { ...activeContext };
      Object.keys(metadata).forEach(key => {
        newContext[key] = () => metadata[key];
      });
      return newContext;
    }
  }

  class MockTracer implements Tracer {
    startSpan(name: string, options?: SpanOptions): Span {
      return new MockSpan(name, options);
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

    setAttribute(key: string, value: any): Span {
      this.attributes[key] = value;
      return this;
    }

    setAttributes(attributes: Attributes): Span {
      this.attributes = { ...this.attributes, ...attributes };
      return this;
    }

    recordException(exception: ExtendedException, time?: Time): void {
      this.exception = exception;
    }

    spanContext(): SpanContext {
      return { traceId: 'mock-trace-id', spanId: 'mock-span-id' };
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
      expect(span.name).to.equal(`${queueName}.testJob Queue.add`);
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
      expect(span.name).to.equal(`${queueName} Queue.addBulk`);
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
      });

      await worker.waitUntilReady();
      const moveToCompletedStub = sinon.stub(job, 'moveToCompleted').resolves();

      const startSpanSpy = sinon.spy(worker.tracer, 'startSpan');

      const token = 'some-token';

      await worker.processJob(job, token, () => false, new Set());

      const span = startSpanSpy.returnValues[0] as MockSpan;

      expect(span).to.be.an.instanceOf(MockSpan);
      expect(span.name).to.equal(`${queueName} ${worker.id} Worker.processJob`);
      expect(span.options?.kind).to.equal(SpanKind.CONSUMER);
      expect(span.attributes[TelemetryAttributes.WorkerId]).to.equal(worker.id);
      expect(span.attributes[TelemetryAttributes.WorkerToken]).to.equal(token);
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
});
