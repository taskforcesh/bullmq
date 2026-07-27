export function after<F extends(...args: any[]) => any>(n: number, func: F) {
  let remaining = n;

  return function (
    this: ThisParameterType<F>,
    ...args: Parameters<F>
  ): ReturnType<F> | undefined {
    remaining -= 1;

    if (remaining < 1) {
      return func.apply(this, args);
    }
  };
}

export function every<T>(
  collection: readonly T[],
  predicate: (value: T, index: number, array: readonly T[]) => unknown,
) {
  return collection.every(predicate);
}

export function times<T>(n: number, iteratee: (index: number) => T) {
  return Array.from({ length: n }, (_, index) => iteratee(index));
}
