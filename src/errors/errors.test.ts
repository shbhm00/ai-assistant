import { describe, expect, it } from 'vitest';
import {
  AIAssistantError,
  ProviderError,
  TimeoutError,
  CancellationError,
  isRetryableError,
  toAIAssistantError,
} from './errors';

describe('errors', () => {
  it('marks ProviderError as retryable by default', () => {
    const err = new ProviderError('boom');
    expect(err.code).toBe('AI_PROVIDER_ERROR');
    expect(err.retryable).toBe(true);
    expect(isRetryableError(err)).toBe(true);
  });

  it('TimeoutError is retryable', () => {
    const err = new TimeoutError();
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('AI_TIMEOUT');
  });

  it('CancellationError is not retryable', () => {
    const err = new CancellationError();
    expect(err.retryable).toBe(false);
    expect(err.code).toBe('AI_CANCELLED');
  });

  it('toAIAssistantError wraps unknown values', () => {
    const err = toAIAssistantError('nope');
    expect(err).toBeInstanceOf(AIAssistantError);
    expect(err.message).toBe('nope');
  });

  it('toJSON omits sensitive cause by default shape', () => {
    const err = new ProviderError('x', { details: { status: 500 } });
    expect(err.toJSON()).toMatchObject({
      code: 'AI_PROVIDER_ERROR',
      message: 'x',
      details: { status: 500 },
    });
  });
});
