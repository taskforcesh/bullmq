import { SpanKind } from '../enums';

export interface Telemetry {
  trace: Trace;
  contextManager: ContextManager;
  tracerName: string;
  propagation: Propagation;
}

export interface ContextManager {
  /**
   * Creates a new context and sets it as active for the fn passed as last argument
   *
   * @param context
   * @param fn
   */
  with<A extends (...args: any[]) => any>(
    context: Context,
    fn: A,
  ): ReturnType<A>;
  active(): Context;
  getMetadata(context: Context): Record<string, string>;
  fromMetadata(
    activeContext: Context,
    metadata: Record<string, string>,
  ): Context;
}

export interface Trace {
  getTracer(name: string, version?: string): Tracer;
  setSpan: SetSpan;
}

export type SetSpan = (context: Context, span: Span) => Context;

export interface Context {
  [key: string]: Function;
}

export interface Tracer {
  startSpan(name: string, options?: SpanOptions): Span;
}

export interface SpanOptions {
  kind: SpanKind;
}

export interface Span {
  setAttribute(key: string, value: Attribute): Span;
  setAttributes(attributes: Attributes): Span;
  recordException(exception: Exception, time?: Time): void;
  spanContext(): SpanContext;
  end(): void;
}

export interface SpanContext {
  traceId: string;
  spanId: string;
}

export interface Attributes {
  [attribute: string]: Attribute | undefined;
}

export type Attribute =
  | string
  | number
  | boolean
  | null
  | undefined
  | (null | undefined | string | number | boolean)[];

export type Exception = string | ExceptionType;

export type ExceptionType = CodeException | MessageException | NameException;

interface CodeException {
  code: string | number;
  name?: string;
  message?: string;
  stack?: string;
}

interface MessageException {
  code?: string | number;
  name?: string;
  message: string;
  stack?: string;
}

interface NameException {
  code?: string | number;
  name: string;
  message?: string;
  stack?: string;
}

export type Time = HighResolutionTime | number | Date;

type HighResolutionTime = [number, number];

export interface Propagation {
  inject<T>(context: Context, carrier: T): void;
  extract<T>(context: Context, carrier: T): Context;
}
