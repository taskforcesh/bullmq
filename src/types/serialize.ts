/**
 * The `Serialize` type emulates the operation `JSON.parse(JSON.stringify(x))` done
 * when passing the `data` to a `Job` in a `Worker`.
 */
export type Serialize<T> =
  /**
   * If the input is any then the output must as well be any
   */
  IsAny<T> extends true
    ? any
    : /**
     * Under the hood, JSON.stringify calls the `toJSON()` method on his parameter.
     */
    T extends { toJSON(): infer U }
    ? U extends JsonValue
      ? U
      : unknown
    : /**
     * Primitives
     */
    T extends JsonPrimitive
    ? T
    : /**
     * Primitive wrappers
     */
    T extends String
    ? string
    : T extends Number
    ? number
    : T extends Boolean
    ? boolean
    : /**
     * JSON.stringify returns always `{}` for a `Promise`
     */
    T extends Promise<unknown>
    ? EmptyObject
    : /**
     * Map
     */
    T extends Map<unknown, unknown>
    ? EmptyObject
    : /**
     * Set
     */
    T extends Set<unknown>
    ? EmptyObject
    : /**
     * Array views
     */
    T extends TypedArray
    ? Record<string, number>
    : /**
     * Some object can't be serialized, so we remove them.
     */
    T extends NotJson
    ? never
    : /**
     * Arrays
     */
    T extends []
    ? []
    : T extends readonly [infer F, ...infer R]
    ? [NeverToNull<Serialize<F>>, ...Serialize<R>]
    : T extends readonly unknown[]
    ? Array<NeverToNull<Serialize<T[number]>>>
    : /**
     * Objects
     */
    T extends Record<keyof unknown, unknown>
    ? Prettify<SerializeObject<T>>
    : /**
     * Unknown
     */
    unknown extends T
    ? unknown
    : never;

/**
 * Some utils.
 */

type NotJson = undefined | symbol | ((...args: any[]) => unknown);

// value is always not JSON => true
// value is always JSON => false
// value is somtimes JSON, sometimes not JSON => boolean
// note: cannot be inlined as logic requires union distribution
type ValueIsNotJson<T> = T extends NotJson ? true : false;

// note: remove optionality so that produced values are never `undefined`,
// only `true`, `false`, or `boolean`
type IsNotJson<T> = { [K in keyof T]-?: ValueIsNotJson<T[K]> };

type SerializeValues<T> = { [K in keyof T]: Serialize<T[K]> };

type SerializeObject<T extends Record<keyof unknown, unknown>> =
  // required
  {
    [K in keyof T as unknown extends T[K]
      ? never
      : IsNotJson<T>[K] extends false
      ? K
      : never]: SerializeValues<T>[K];
  } & {
    // optional
    [K in keyof T as unknown extends T[K]
      ? K
      : // if the value is always JSON, then it's not optional
      IsNotJson<T>[K] extends false
      ? never
      : // if the value is always not JSON, omit it entirely
      IsNotJson<T>[K] extends true
      ? never
      : // if the value is mixed, then it's optional
        K]?: SerializeValues<T>[K];
  };

type JsonPrimitive = string | number | boolean | null;

type JsonArray = JsonValue[] | readonly JsonValue[];

type JsonObject = { [K in string]: JsonValue } & { [K in string]?: JsonValue };

type JsonValue = JsonPrimitive | JsonObject | JsonArray;

type TypedArray =
  | Int8Array
  | Uint8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array
  | BigInt64Array
  | BigUint64Array;

type Prettify<T> = { [K in keyof T]: T[K] } & {};

type NeverToNull<T> = [T] extends [never] ? null : T;

declare const emptyObjectSymbol: unique symbol;
type EmptyObject = { [emptyObjectSymbol]?: never };

type IsAny<T> = 0 extends 1 & T ? true : false;
