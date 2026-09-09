import { describe, expect, it, vi } from 'vitest';
import { withRetry, computeBackoffDelay } from './retry';
import { withTimeout } from './timeout';
import { createCancelScope } from './cancellation';
import { ProviderError, TimeoutError, CancellationError } from '../errors/errors';

describe('retry', () => {
  it('computes exponential backoff', () => {
    expect(computeBackoffDelay(1, { backoff: 'exponential', initialDelayMs: 100, maxDelayMs: 10_000 })).toBe(100);
    expect(computeBackoffDelay(2, { backoff: 'exponential', initialDelayMs: 100, maxDelayMs: 10_000 })).toBe(200);
    expect(computeBackoffDelay(3, { backoff: 'exponential', initialDelayMs: 100, maxDelayMs: 10_000 })).toBe(400);
  });

  it('retries retryable errors only', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new ProviderError('temp');
        }
        return 'ok';
      },
      { maxRetries: 3, initialDelayMs: 1, backoff: 'none' }
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('does not retry non-retryable errors', async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new ProviderError('perm', { retryable: false });
        },
        { maxRetries: 3, initialDelayMs: 1 }
      )
    ).rejects.toMatchObject({ retryable: false });
    expect(attempts).toBe(1);
  });
});

describe('timeout', () => {
  it('rejects when operation exceeds timeout', async () => {
    await expect(
      withTimeout(() => new Promise(() => undefined), { timeoutMs: 20 })
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('resolves when operation finishes in time', async () => {
    const value = await withTimeout(async () => 'done', { timeoutMs: 100 });
    expect(value).toBe('done');
  });
});

describe('cancellation', () => {
  it('abort propagates CancellationError', async () => {
    const scope = createCancelScope();
    const spy = vi.fn();
    scope.signal.addEventListener('abort', spy);
    scope.cancel();
    expect(scope.isCancelled()).toBe(true);
    expect(scope.signal.aborted).toBe(true);
    expect(scope.signal.reason).toBeInstanceOf(CancellationError);
  });
});
