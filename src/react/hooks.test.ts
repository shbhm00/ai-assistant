import { describe, expect, it } from 'vitest';
import { createAIAssistant } from '../core/AIAssistant';
import { MockAIProvider } from '../providers/MockAIProvider';
import { useAIAssistant, useAISession, useAIStreaming } from './hooks';

describe('react adapter exports', () => {
  it('exports hooks for optional React integration', () => {
    expect(typeof useAIAssistant).toBe('function');
    expect(typeof useAISession).toBe('function');
    expect(typeof useAIStreaming).toBe('function');
  });

  it('session used by hooks remains framework-agnostic', async () => {
    const assistant = createAIAssistant({
      provider: new MockAIProvider({
        responses: ['Hello there'],
        streamTokenDelayMs: 0,
      }),
    });
    // Mirrors what useAISession/useAIStreaming wrap
    const session = assistant.createSession({ id: 'hook-session' });
    const tokens: string[] = [];
    const handle = session.streamMessage('q', {
      onToken: (t) => tokens.push(t),
    });
    const response = await handle.promise;
    expect(tokens.join('')).toBe('Hello there');
    expect(response.message.content).toBe('Hello there');
    expect(useAIAssistant(assistant)).toBe(assistant);
  });
});
