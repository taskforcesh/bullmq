import { expect } from 'chai';
import { default as IORedis } from 'ioredis';
import { after, beforeEach, describe, it, before } from 'mocha';
import { v4 } from 'uuid';
import { Queue, Worker } from '../src/classes';
import { removeAllQueueData } from '../src/utils';
import {
  Telemetry,
  Trace,
  ContextManager,
  Propagation,
  Tracer,
  Span,
  SpanOptions,
  Attributes,
  Exception,
  Time,
  SpanContext,
  Context,
} from '../src/interfaces';
import { SpanKind, TelemetryAttributes } from '../src/enums';
import * as sinon from 'sinon';

describe('Telemetry', () => {
  type ExtendedException = Exception & {
    message: string;
  };

  const redisHost = process.env.REDIS_HOST || 'localhost';
  const prefix = process.env.BULLMQ_TEST_PREFIX || 'bull';

  class MockTelemetry implements Telemetry {
    public trace: Trace;
    public contextManager: ContextManager;
    public propagation: Propagation;
    public tracerName = 'mockTracer';

    constructor() {
      this.trace = new MockTrace();
      this.contextManager = new MockContextManager();
      this.propagation = new MockPropagation();
    }
  }

  class MockTrace implements Trace {
    getTracer(): Tracer {
      return new MockTracer();
    }

    setSpan(context: Context, span: Span): Context {
      const newContext = { ...context };
      newContext['getSpan'] = () => span;
      return newContext;
    }
  }

  class MockContextManager implements ContextManager {
    private activeContext: Context = {};

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
      Object.keys(context).forEach(key => {
        if (key.startsWith('getMetadata_')) {
          const value = (context[key] as () => string)();
          metadata[key.replace('getMetadata_', '')] = value;
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
        newContext[`getMetadata_${key}`] = () => metadata[key];
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

  class MockPropagation implements Propagation {
    inject<T>(context: Context, carrier: T): void {}

    extract<T>(context: Context, carrier: T): Context {
      const newContext = { ...context };
      newContext['extractedFunction'] = () => {};

      return newContext;
    }
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
    telemetryClient = new MockTelemetry();
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
      const addStub = sinon
        .stub(queue, 'add')
        .rejects(new Error('Simulated error'));

      const span = telemetryClient.trace
        .getTracer('testtracer')
        .startSpan('Queue.add.error') as MockSpan;
      const recordExceptionSpy = sinon.spy(span, 'recordException');

      const activeContext = telemetryClient.contextManager.active();
      activeContext['getSpan'] = () => span;

      try {
        await queue.add('testJob', { foo: 'bar' });

        expect.fail('Expected an error to be thrown');
      } catch (error) {
        span.recordException(error);

        sinon.assert.calledOnce(recordExceptionSpy);
        const [exception] = recordExceptionSpy.firstCall.args;
        expect(exception?.message).to.equal('Simulated error');
      } finally {
        addStub.restore();
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
      const jobs = [
        { name: 'job1', data: { foo: 'bar' } },
        { name: 'job2', data: { baz: 'qux' } },
      ];

      const addBulkStub = sinon
        .stub(queue.Job, 'createBulk')
        .rejects(new Error('Simulated bulk error'));

      const span = telemetryClient.trace
        .getTracer('testtracer')
        .startSpan('Queue.addBulk.error') as MockSpan;
      const recordExceptionSpy = sinon.spy(span, 'recordException');

      const activeContext = telemetryClient.contextManager.active();
      activeContext['getSpan'] = () => span;

      try {
        await queue.addBulk(jobs);

        expect.fail('Expected an error to be thrown');
      } catch (error) {
        span.recordException(error);

        sinon.assert.calledOnce(recordExceptionSpy);
        const [exception] = recordExceptionSpy.firstCall.args;
        expect(exception?.message).to.equal('Simulated bulk error');
      } finally {
        addBulkStub.restore();
      }
    });
  });

  describe('Worker.processJob', async () => {
    it('should correctly interact with telemetry when processing a job', async () => {
      const worker = new Worker(queueName, async () => 'some result', {
        connection,
        telemetry: telemetryClient,
      });
      await worker.waitUntilReady();

      const job = await queue.add('testJob', { foo: 'bar' });
      const token = 'some-token';

      const moveToCompletedStub = sinon.stub(job, 'moveToCompleted').resolves();

      await worker.processJob(job, token, () => false, new Set());

      const activeContext = telemetryClient.contextManager.active();
      const span = activeContext.getSpan?.() as MockSpan;

      expect(span).to.be.an.instanceOf(MockSpan);
      expect(span.name).to.equal(`${queueName} ${worker.id} Worker.processJob`);
      expect(span.options?.kind).to.equal(SpanKind.CONSUMER);
      expect(span.attributes[TelemetryAttributes.WorkerId]).to.equal(worker.id);
      expect(span.attributes[TelemetryAttributes.WorkerToken]).to.equal(token);
      expect(span.attributes[TelemetryAttributes.JobId]).to.equal(job.id);

      moveToCompletedStub.restore();
      await worker.close();
    });
  });
});
