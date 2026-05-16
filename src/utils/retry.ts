/**
 * Options for the retry logic.
 */
type RetryOptions = {
  /** Maximum number of attempts. */
  retries: number;
  /** Delay between attempts in milliseconds. */
  retryDelayMs: number;
  /** Optional signal to cancel the execution. */
  signal?: AbortSignal;

  /**
   * The backoff strategy to use.
   * 'fixed': Fixed delay.
   * 'linear': Linear increase (retryDelayMs * attempt).
   * 'exponential': Exponential increase (retryDelayMs * 2^attempt).
   */
  backoffFactor?: 'fixed' | 'linear' | 'exponential';
  jitter?: boolean;
  maxRetryDelayMs?: number;
};

/**
 * Executes a function with retry logic in case of failure.
 * @template T The return type of the function.
 * @param fn The function to be executed.
 * @param options Retry settings.
 * @returns The result of the function if successful.
 * @throws The last error occurred if all attempts fail.
 */
export async function runWithRetry<T>(
  fn: () => Promise<T> | T,
  options: RetryOptions
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= options.retries; attempt++) {
    if (options.signal?.aborted) {
      throw options.signal.reason;
    }

    let multiplierExpression: number;

    switch (options.backoffFactor) {
      case 'fixed':
        multiplierExpression = options.retryDelayMs;
        break;
      case 'linear':
        multiplierExpression = (options.retryDelayMs * (attempt + 1));
        break;
      case 'exponential':
        multiplierExpression = (options.retryDelayMs * Math.pow(2, attempt));
        break;
      default:
        multiplierExpression = options.retryDelayMs;
        break;
    }

    if (options.maxRetryDelayMs && multiplierExpression > options.maxRetryDelayMs) {
      multiplierExpression = options.maxRetryDelayMs;
    }

    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < options.retries && options.retryDelayMs > 0) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, options.jitter ? Math.random() * multiplierExpression : multiplierExpression);
          options.signal?.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(options.signal?.reason);
          }, { once: true });
        });
      }
    }
  }

  throw lastError;
}
