export type JsonObject = { [key: string]: JsonValue };

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | JsonObject;

/**
 * Serialize job data into a custom JSON compatible object
 *
 * @param data - the job data
 * @returns a JSON compatible object
 */
export type SerializeFn = (data: any) => JsonValue;

/**
 * Deserialize job data into a custom JSON compatible object
 *
 * @param data - the stringified job data
 * @returns a JSON compatible object
 */
export type DeserializeFn = (data: string) => JsonValue;
