import { SpanKind } from '../enums';

export interface Telemetry<Context = any> {
  trace: Trace;
  contextManager: ContextManager;
  tracerName: string;
}

export interface ContextManager<Context = any> {
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
  getMetadata(context: Context): Carrier;
  fromMetadata(activeContext: Context, metadata: Carrier): Context;
}

export interface Carrier {
  traceparent?: string;
  tracestate?: string;
}

export interface Trace<Span = any, Context = any> {
  getTracer(name: string, version?: string): Tracer;
  setSpan: SetSpan;
}

export type SetSpan<Context = any, Span = any> = (
  context: Context,
  span: Span,
) => Context;

export interface Tracer<Context = any> {
  startSpan(name: string, options?: SpanOptions, context?: Context): Span;
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
