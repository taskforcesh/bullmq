export interface Telemetry {
  trace: Trace;
  contextManager: ContextManager;
  tracerName: string;
}

export interface ContextManager {
  with<A extends (...args: any[]) => any>(
    context: Context,
    fn: A,
  ): ReturnType<A>;
  active(): Context;
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
  startSpan(name: string): Span;
}

export interface Span {
  setAttribute(key: string, value: Attribute): Span;
  setAttributes(attributes: Attributes): Span;
  recordException(exception: Exception, time?: Time): void;
  end(): void;
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
