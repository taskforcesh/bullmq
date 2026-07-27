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
  collection: readonly T[] | Record<string, T>,
  predicate: (
    value: T,
    indexOrKey: number | string,
    collection: readonly T[] | Record<string, T>,
  ) => unknown,
) {
  if (Array.isArray(collection)) {
    return collection.every((value, index) =>
      Boolean(predicate(value, index, collection)),
    );
  }

  return Object.entries(collection).every(([key, value]) =>
    Boolean(predicate(value, key, collection)),
  );
}

export function times<T>(n: number, iteratee: (index: number) => T) {
  return Array.from({ length: n }, (_, index) => iteratee(index));
}
