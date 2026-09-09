import { describe, expect, it, vi } from 'vitest';
import { MockAIProvider } from './MockAIProvider';
import { HttpGatewayProvider } from './HttpGatewayProvider';
import { CancellationError, ProviderError } from '../errors/errors';
import type { AIRequest } from './AIProvider';
import { createId } from '../utils/id';

function baseRequest(): AIRequest {
  return {
    requestId: createId('req'),
    sessionId: 's1',
    messages: [
      {
        id: 'm1',
        role: 'user',
        content: 'hello',
        createdAt: Date.now(),
      },
    ],
  };
}

describe('MockAIProvider', () => {
  it('returns scripted text responses', async () => {
    const provider = new MockAIProvider({ responses: ['one', 'two'] });
    const a = await provider.generateResponse(baseRequest());
    const b = await provider.generateResponse(baseRequest());
    expect(a.message.content).toBe('one');
    expect(b.message.content).toBe('two');
  });

  it('streams tokens', async () => {
    const provider = new MockAIProvider({
      responses: ['hello world'],
      streamTokenDelayMs: 0,
    });
    const tokens: string[] = [];
    const response = await provider.streamResponse(baseRequest(), {
      onToken: (t) => tokens.push(t),
    });
    expect(tokens.join('')).toBe('hello world');
    expect(response.message.content).toBe('hello world');
  });

  it('supports deterministic tool-call scenarios', async () => {
    const provider = new MockAIProvider({
      scenarios: [
        {
          type: 'tool_calls',
          toolCalls: [{ name: 'getNetworkInfo', arguments: {} }],
        },
        { type: 'text', content: 'Network is fine' },
      ],
    });
    const first = await provider.generateResponse(baseRequest());
    expect(first.toolCalls?.[0]?.name).toBe('getNetworkInfo');
    const second = await provider.generateResponse(baseRequest());
    expect(second.message.content).toBe('Network is fine');
  });

  it('honours cancellation during delay', async () => {
    const provider = new MockAIProvider({
      scenarios: [{ type: 'text', content: 'slow', delayMs: 200 }],
    });
    const controller = new AbortController();
    const promise = provider.generateResponse(baseRequest(), controller.signal);
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(CancellationError);
  });
});

describe('HttpGatewayProvider', () => {
  it('posts to generate endpoint and maps response', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          message: { role: 'assistant', content: 'from gateway' },
          finishReason: 'stop',
          usage: { totalTokens: 3 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const provider = new HttpGatewayProvider({
      baseUrl: 'https://gateway.test',
      fetch: fetchMock as unknown as typeof fetch,
      headers: { Authorization: 'Bearer session-token' },
    });

    const response = await provider.generateResponse(baseRequest());
    expect(response.message.content).toBe('from gateway');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://gateway.test/v1/generate');
    expect((init as RequestInit).method).toBe('POST');
  });

  it('maps HTTP errors with retryable flag for 5xx', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'down' } }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    const provider = new HttpGatewayProvider({
      baseUrl: 'https://gateway.test',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(provider.generateResponse(baseRequest())).rejects.toMatchObject({
      message: 'down',
      retryable: true,
    } satisfies Partial<ProviderError>);
  });

  it('consumes NDJSON stream events', async () => {
    const ndjson = [
      JSON.stringify({ type: 'token', token: 'Hi' }),
      JSON.stringify({ type: 'token', token: '!' }),
      JSON.stringify({ type: 'done', finishReason: 'stop' }),
    ].join('\n');

    const fetchMock = vi.fn(
      async () =>
        new Response(ndjson, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        })
    );

    const provider = new HttpGatewayProvider({
      baseUrl: 'https://gateway.test',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const tokens: string[] = [];
    const response = await provider.streamResponse(baseRequest(), {
      onToken: (t) => tokens.push(t),
    });
    expect(tokens.join('')).toBe('Hi!');
    expect(response.message.content).toBe('Hi!');
  });
});
