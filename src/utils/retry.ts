import type { RetryConfig } from '../core/types';
import { isRetryableError, toAIAssistantError } from '../errors/errors';
import { throwIfAborted } from './cancellation';

export interface RetryOptions extends Partial<RetryConfig> {
  signal?: AbortSignal;
  /** Called before each retry (attempt is 1-based retry count). */
  onRetry?: (info: { attempt: number; error: unknown; delayMs: number }) => void;
}

const DEFAULTS: RetryConfig = {
  maxRetries: 2,
  backoff: 'exponential',
  initialDelayMs: 300,
  maxDelayMs: 5_000,
};

export function computeBackoffDelay(
  attempt: number,
  config: Pick<RetryConfig, 'backoff' | 'initialDelayMs' | 'maxDelayMs'>
): number {
  const { backoff, initialDelayMs, maxDelayMs } = config;
  if (backoff === 'none') {
    return 0;
  }
  if (backoff === 'linear') {
    return Math.min(initialDelayMs * attempt, maxDelayMs);
  }
  // exponential
  const delay = initialDelayMs * 2 ** (attempt - 1);
  return Math.min(delay, maxDelayMs);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const onAbort = () => {
      cleanup();
      reject(signal?.reason ?? new Error('Aborted'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(signal.reason ?? new Error('Aborted'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Retries an async operation for retryable failures only.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const config: RetryConfig = {
    maxRetries: options.maxRetries ?? DEFAULTS.maxRetries,
    backoff: options.backoff ?? DEFAULTS.backoff,
    initialDelayMs: options.initialDelayMs ?? DEFAULTS.initialDelayMs,
    maxDelayMs: options.maxDelayMs ?? DEFAULTS.maxDelayMs,
  };

  let lastError: unknown;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    throwIfAborted(options.signal);

    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const retryable = isRetryableError(error);
      const hasRetriesLeft = attempt < config.maxRetries;

      if (!retryable || !hasRetriesLeft) {
        throw toAIAssistantError(error);
      }

      const delayMs = computeBackoffDelay(attempt + 1, config);
      options.onRetry?.({ attempt: attempt + 1, error, delayMs });
      await sleep(delayMs, options.signal);
    }
  }

  throw toAIAssistantError(lastError);
}
