/**
 * Executes a promise with a timeout.
 * @template T The return type of the promise.
 * @param promise The promise to be executed.
 * @param timeoutMs Timeout in milliseconds.
 * @returns The result of the original promise.
 * @throws Timeout error if the time is exceeded.
 */
export function runWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Step timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}