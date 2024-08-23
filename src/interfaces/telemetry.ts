export interface Telemetry {
  tracer: Tracer;
}

export interface Tracer {
  startSpan(name: string): Span;
}

export interface Span {
  setAttribute(key: string, value: Attribute): Span;
  setAttributes(attributes: Attributes): Span;
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
