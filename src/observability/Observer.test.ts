import { describe, expect, it } from 'vitest';
import { composeObservers, noopObserver } from './Observer';
import type { ObserverRequestEvent } from './Observer';

describe('composeObservers', () => {
  it('returns noop for empty list', () => {
    expect(composeObservers()).toBe(noopObserver);
  });

  it('invokes all observers and swallows callback errors', () => {
    const calls: string[] = [];
    const event = {
      requestId: 'r',
      sessionId: 's',
      provider: 'mock',
      streaming: false,
      toolCount: 0,
      startedAt: 1,
    } satisfies ObserverRequestEvent;

    const composed = composeObservers(
      {
        onRequestStart: () => {
          calls.push('a');
          throw new Error('observer bug');
        },
      },
      {
        onRequestStart: () => {
          calls.push('b');
        },
      }
    );

    expect(() => composed.onRequestStart?.(event)).not.toThrow();
    expect(calls).toEqual(['a', 'b']);
  });
});
