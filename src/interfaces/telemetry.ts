import { SpanKind } from '../enums';

export interface Telemetry<Context = any> {
  tracer: Tracer<Context>;
  contextManager: ContextManager;
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
  getMetadata(context: Context): string;
  fromMetadata(activeContext: Context, metadata: string): Context;
}

export interface Tracer<Context = any> {
  startSpan(name: string, options?: SpanOptions, context?: Context): Span;
}

export interface SpanOptions {
  kind: SpanKind;
}

export interface Span<Context = any> {
  setSpanOnContext(ctx: Context): void;
  setAttribute(key: string, value: AttributeValue): void;
  setAttributes(attributes: Attributes): void;
  addEvent(name: string, attributes?: Attributes): void;
  recordException(exception: Exception, time?: Time): void;
  end(): void;
}

export interface Attributes {
  [attribute: string]: AttributeValue | undefined;
}

export type AttributeValue =
  | string
  | number
  | boolean
  | Array<null | undefined | string>
  | Array<null | undefined | number>
  | Array<null | undefined | boolean>;

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
