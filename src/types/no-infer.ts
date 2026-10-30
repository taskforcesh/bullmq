/**
 * Blocks inference from `T`, like the built-in `NoInfer` from TypeScript 5.4,
 * but also works with older compilers that consume the published declarations.
 */
export type NoInferType<T> = [T][T extends any ? 0 : never];
