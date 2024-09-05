export interface Telemetry {
  tracer: Tracer;
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
