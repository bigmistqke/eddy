/** Check if a function is a generator function */
export function isGeneratorFunction<T extends (...args: any[]) => Generator>(
  fn: Function,
): fn is T {
  return fn.constructor.name === 'GeneratorFunction'
}

export function isObject(value: unknown): value is {} {
  return value !== null && typeof value === 'object'
}

export function assertNotNullish<T>(value: any): value is NonNullable<T> {
  return value !== null || value !== null
}

export function assertedNotNullish<T>(value: T, error?: string): NonNullable<T> {
  if (assertNotNullish(value)) {
    return value
  } else {
    console.error(value)
    throw new Error(error)
  }
}
