import { describe, expect, it, vi } from 'vitest';
import { createAIAssistant } from '../core/AIAssistant';
import { MockAIProvider } from '../providers/MockAIProvider';
import { ConfigurationError, CancellationError } from '../errors/errors';
import type { AIAssistantObserver } from '../observability/Observer';

describe('createAIAssistant + session', () => {
  it('requires a provider', () => {
    expect(() =>
      // @ts-expect-error intentional
      createAIAssistant({})
    ).toThrow(ConfigurationError);
  });

  it('sends a message with mock provider', async () => {
    const assistant = createAIAssistant({
      provider: new MockAIProvider({ responses: ['hello'] }),
    });
    const session = assistant.createSession({ id: 's1' });
    const response = await session.sendMessage('ping');
    expect(response.message.content).toBe('hello');
    expect(session.getHistory()).toHaveLength(2);
  });

  it('runs tool loop end-to-end', async () => {
    const provider = new MockAIProvider({
      scenarios: [
        {
          type: 'tool_calls',
          toolCalls: [{ name: 'getNetworkInfo', arguments: {} }],
        },
        { type: 'text', content: 'You are on wifi' },
      ],
    });

    const assistant = createAIAssistant({ provider });
    assistant.registerTool({
      name: 'getNetworkInfo',
      description: 'network info',
      execute: async () => ({ networkType: 'wifi', connected: true }),
    });

    const session = assistant.createSession();
    const response = await session.sendMessage('Why is network slow?');
    expect(response.message.content).toBe('You are on wifi');
    const roles = session.getHistory().map((m) => m.role);
    expect(roles).toContain('tool');
  });

  it('filters sensitive context before provider sees it', async () => {
    const seen: unknown[] = [];
    const provider = new MockAIProvider({ responses: ['ok'] });
    const original = provider.generateResponse.bind(provider);
    provider.generateResponse = async (request, signal) => {
      seen.push(request.context);
      return original(request, signal);
    };

    const assistant = createAIAssistant({
      provider,
      security: { blockedFields: ['sessionToken'] },
    });
    assistant.registerContextProvider({
      name: 'auth',
      getContext: () => ({
        userId: 'u1',
        password: 'secret',
        sessionToken: 'abc',
      }),
    });

    await assistant.createSession().sendMessage('hi');
    expect(seen[0]).toMatchObject({
      auth: {
        userId: 'u1',
        password: '[REDACTED]',
        sessionToken: '[REDACTED]',
      },
    });
  });

  it('supports streaming cancellation', async () => {
    const provider = new MockAIProvider({
      scenarios: [{ type: 'text', content: 'abcdefghij', delayMs: 30 }],
      streamTokenDelayMs: 30,
    });
    const assistant = createAIAssistant({ provider });
    const session = assistant.createSession();
    const handle = session.streamMessage('stream please');
    handle.cancel();
    await expect(handle.promise).rejects.toBeInstanceOf(CancellationError);
  });

  it('emits observer events without prompt payloads', async () => {
    const events: string[] = [];
    const observer: AIAssistantObserver = {
      onRequestStart: () => events.push('start'),
      onRequestComplete: (e) => {
        events.push('complete');
        expect('messages' in e).toBe(false);
      },
      onToolStart: () => events.push('toolStart'),
      onToolComplete: () => events.push('toolComplete'),
    };

    const provider = new MockAIProvider({
      scenarios: [
        { type: 'tool_calls', toolCalls: [{ name: 'ping' }] },
        { type: 'text', content: 'pong' },
      ],
    });
    const assistant = createAIAssistant({ provider, observer });
    assistant.registerTool({
      name: 'ping',
      description: 'ping',
      execute: async () => ({ ok: true }),
    });
    await assistant.createSession().sendMessage('x');
    expect(events).toEqual(['start', 'toolStart', 'toolComplete', 'complete']);
  });

  it('trims history to maxHistoryMessages', async () => {
    const provider = new MockAIProvider({
      responses: ['1', '2', '3', '4'],
    });
    const assistant = createAIAssistant({
      provider,
      session: { maxHistoryMessages: 3 },
    });
    const session = assistant.createSession();
    await session.sendMessage('a');
    await session.sendMessage('b');
    expect(session.getHistory().length).toBeLessThanOrEqual(3);
  });

  it('falls back to secondary provider', async () => {
    const primary = new MockAIProvider({
      scenarios: [{ type: 'error', message: 'primary down', retryable: false }],
    });
    const fallback = new MockAIProvider({ responses: ['fallback ok'] });
    const assistant = createAIAssistant({
      provider: primary,
      fallbackProvider: fallback,
      retry: { maxRetries: 0 },
    });
    const response = await assistant.createSession().sendMessage('hi');
    expect(response.message.content).toBe('fallback ok');
  });

  it('dispose prevents further use', () => {
    const assistant = createAIAssistant({
      provider: new MockAIProvider({ responses: ['x'] }),
    });
    assistant.dispose();
    expect(() => assistant.createSession()).toThrow(ConfigurationError);
  });
});

describe('defaults', () => {
  it('uses maxToolRounds=5 and maxHistory=50', () => {
    const assistant = createAIAssistant({
      provider: new MockAIProvider(),
    });
    const config = assistant.getConfig();
    expect(config.session.maxToolRounds).toBe(5);
    expect(config.session.maxHistoryMessages).toBe(50);
  });
});
