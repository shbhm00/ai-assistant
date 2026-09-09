import type { Message, ToolCall, TokenUsage } from '../core/types';
import {
  CancellationError,
  ProviderError,
  toAIAssistantError,
} from '../errors/errors';
import { createId } from '../utils/id';
import { throwIfAborted, onAbort } from '../utils/cancellation';
import type {
  AIProvider,
  AIRequest,
  AIResponse,
  StreamCallbacks,
} from './AIProvider';

/**
 * Thin HTTP client targeting a generic AI gateway.
 * Does NOT depend on OpenAI, Anthropic, Gemini, or any vendor SDK.
 *
 * Expected gateway contract (JSON):
 *
 * POST {baseUrl}/v1/generate
 * POST {baseUrl}/v1/stream   (NDJSON or SSE: data: {json}\n\n)
 *
 * Request body:
 * {
 *   requestId, sessionId, messages, tools, context, model, metadata
 * }
 *
 * Non-stream response:
 * {
 *   message: { role, content, toolCalls? },
 *   usage?, model?, finishReason?
 * }
 *
 * Stream events (NDJSON lines or SSE data payloads):
 * { type: 'token', token: string }
 * { type: 'tool_call', toolCall: { id, name, arguments } }
 * { type: 'usage', usage: {...} }
 * { type: 'done', message?, finishReason?, usage?, model? }
 * { type: 'error', message: string, retryable?: boolean }
 */

export interface HttpGatewayProviderOptions {
  /** Gateway base URL, e.g. https://ai-gateway.internal */
  baseUrl: string;
  /** Optional headers (prefer short-lived session tokens from your BFF — never embed LLM API keys). */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  /** Fetch implementation (defaults to global fetch). */
  fetch?: typeof fetch;
  model?: string;
  generatePath?: string;
  streamPath?: string;
  /** Request timeout hint passed as header; actual timeout enforced by core. */
  name?: string;
}

interface GatewayResponseBody {
  message?: {
    role?: string;
    content?: string;
    toolCalls?: Array<{
      id?: string;
      name: string;
      arguments?: Record<string, unknown>;
    }>;
  };
  usage?: TokenUsage;
  model?: string;
  finishReason?: AIResponse['finishReason'];
  error?: { message: string; retryable?: boolean; code?: string };
}

export class HttpGatewayProvider implements AIProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly headers?: HttpGatewayProviderOptions['headers'];
  private readonly fetchImpl: typeof fetch;
  private readonly model?: string;
  private readonly generatePath: string;
  private readonly streamPath: string;

  constructor(options: HttpGatewayProviderOptions) {
    if (!options.baseUrl?.trim()) {
      throw new ProviderError('HttpGatewayProvider requires baseUrl', {
        retryable: false,
        code: 'AI_CONFIGURATION_ERROR',
      });
    }
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.headers = options.headers;
    this.fetchImpl = options.fetch ?? fetch.bind(globalThis);
    this.model = options.model;
    this.generatePath = options.generatePath ?? '/v1/generate';
    this.streamPath = options.streamPath ?? '/v1/stream';
    this.name = options.name ?? 'http-gateway';
  }

  async generateResponse(
    request: AIRequest,
    signal?: AbortSignal
  ): Promise<AIResponse> {
    throwIfAborted(signal);
    const response = await this.request(this.generatePath, request, signal);
    return this.mapResponse(response, request);
  }

  async streamResponse(
    request: AIRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<AIResponse> {
    throwIfAborted(signal);

    const headers = await this.resolveHeaders();
    const body = this.serializeRequest(request);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${this.streamPath}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson, text/event-stream, application/json',
          ...headers,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      throw this.mapFetchError(error);
    }

    if (!response.ok) {
      throw await this.mapHttpError(response);
    }

    const contentType = response.headers.get('content-type') ?? '';

    // Some gateways may fall back to a single JSON body.
    if (contentType.includes('application/json') && !contentType.includes('ndjson')) {
      const json = (await response.json()) as GatewayResponseBody;
      return this.emitMappedResponse(json, request, callbacks);
    }

    // React Native fetch often has no ReadableStream body. Prefer buffered
    // text (full NDJSON) or non-stream /v1/generate fallback.
    if (!response.body) {
      try {
        const text = await response.text();
        if (text?.trim()) {
          return this.consumeBufferedStream(text, callbacks, request);
        }
      } catch {
        // fall through to generate fallback
      }
      return this.streamViaGenerateFallback(request, callbacks, signal);
    }

    return this.consumeStream(response.body, callbacks, request, signal);
  }

  /**
   * RN-friendly path: call /v1/generate and synthesize onToken callbacks.
   */
  private async streamViaGenerateFallback(
    request: AIRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<AIResponse> {
    const mapped = await this.generateResponse(request, signal);
    return this.emitCompletedAsStream(mapped, callbacks);
  }

  private emitMappedResponse(
    json: GatewayResponseBody,
    request: AIRequest,
    callbacks: StreamCallbacks
  ): AIResponse {
    const mapped = this.mapResponse(json, request);
    return this.emitCompletedAsStream(mapped, callbacks);
  }

  private emitCompletedAsStream(
    mapped: AIResponse,
    callbacks: StreamCallbacks
  ): AIResponse {
    for (const tc of mapped.toolCalls ?? []) {
      callbacks.onToolCall?.(tc);
    }
    const content = mapped.message.content || '';
    if (content) {
      // Chunk for UI streaming feel even when transport is non-stream.
      const parts = content.match(/\S+\s*/g) ?? [content];
      for (const part of parts) {
        callbacks.onToken?.(part);
      }
    }
    callbacks.onMessage?.(mapped.message);
    if (mapped.usage) {
      callbacks.onUsage?.(mapped.usage);
    }
    return mapped;
  }

  private consumeBufferedStream(
    raw: string,
    callbacks: StreamCallbacks,
    request: AIRequest
  ): AIResponse {
    let content = '';
    const toolCalls: ToolCall[] = [];
    let usage: TokenUsage | undefined;
    let model = this.model;
    let finishReason: AIResponse['finishReason'] = 'stop';

    const lines = raw.split(/\r?\n/);
    for (const rawLine of lines) {
      const event = parseStreamLine(rawLine);
      if (!event) {
        continue;
      }
      switch (event.type) {
        case 'token': {
          content += event.token ?? '';
          if (event.token) {
            callbacks.onToken?.(event.token);
          }
          break;
        }
        case 'tool_call': {
          if (event.toolCall) {
            const tc: ToolCall = {
              id: event.toolCall.id ?? createId('tool'),
              name: event.toolCall.name,
              arguments: event.toolCall.arguments ?? {},
            };
            toolCalls.push(tc);
            callbacks.onToolCall?.(tc);
          }
          break;
        }
        case 'usage': {
          usage = event.usage;
          if (usage) {
            callbacks.onUsage?.(usage);
          }
          break;
        }
        case 'error': {
          throw new ProviderError(extractStreamErrorMessage(event), {
            retryable: event.retryable ?? true,
          });
        }
        case 'done': {
          if (event.message?.content) {
            content = event.message.content;
          }
          if (event.usage) {
            usage = event.usage;
          }
          if (event.model) {
            model = event.model;
          }
          finishReason =
            event.finishReason ??
            (toolCalls.length > 0 ? 'tool_calls' : 'stop');
          break;
        }
        default:
          break;
      }
    }

    // If buffer was a single JSON generate payload instead of NDJSON.
    if (!content && toolCalls.length === 0) {
      try {
        const json = JSON.parse(raw) as GatewayResponseBody;
        return this.emitMappedResponse(json, request, callbacks);
      } catch {
        // ignore
      }
    }

    const message: Message = {
      id: createId('msg'),
      role: 'assistant',
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      createdAt: Date.now(),
      meta: { requestId: request.requestId },
    };
    callbacks.onMessage?.(message);

    return {
      message,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      model,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : finishReason,
    };
  }

  private async request(
    path: string,
    request: AIRequest,
    signal?: AbortSignal
  ): Promise<GatewayResponseBody> {
    const headers = await this.resolveHeaders();
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...headers,
        },
        body: JSON.stringify(this.serializeRequest(request)),
        signal,
      });

      if (!response.ok) {
        throw await this.mapHttpError(response);
      }

      return (await response.json()) as GatewayResponseBody;
    } catch (error) {
      throw this.mapFetchError(error);
    }
  }

  private serializeRequest(request: AIRequest): Record<string, unknown> {
    return {
      requestId: request.requestId,
      sessionId: request.sessionId,
      messages: request.messages.map(serializeMessage),
      tools: request.tools,
      context: request.context,
      model: request.model ?? this.model,
      metadata: request.metadata,
    };
  }

  private mapResponse(body: GatewayResponseBody, request: AIRequest): AIResponse {
    if (body.error) {
      throw new ProviderError(body.error.message, {
        retryable: body.error.retryable ?? true,
        details: { code: body.error.code },
      });
    }

    const toolCalls = (body.message?.toolCalls ?? []).map<ToolCall>((tc) => ({
      id: tc.id ?? createId('tool'),
      name: tc.name,
      arguments: tc.arguments ?? {},
    }));

    const message: Message = {
      id: createId('msg'),
      role: 'assistant',
      content: body.message?.content ?? '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      createdAt: Date.now(),
      meta: { requestId: request.requestId },
    };

    return {
      message,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: body.usage,
      model: body.model ?? this.model,
      finishReason:
        body.finishReason ??
        (toolCalls.length > 0 ? 'tool_calls' : 'stop'),
      raw: body,
    };
  }

  private async consumeStream(
    body: ReadableStream<Uint8Array>,
    callbacks: StreamCallbacks,
    request: AIRequest,
    signal?: AbortSignal
  ): Promise<AIResponse> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const toolCalls: ToolCall[] = [];
    let usage: TokenUsage | undefined;
    let model = this.model;
    let finishReason: AIResponse['finishReason'] = 'stop';

    const cancelReader = onAbort(signal, () => {
      void reader.cancel();
    });

    try {
      while (true) {
        throwIfAborted(signal);
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';

        for (const rawLine of lines) {
          const event = parseStreamLine(rawLine);
          if (!event) {
            continue;
          }

          switch (event.type) {
            case 'token': {
              content += event.token ?? '';
              if (event.token) {
                callbacks.onToken?.(event.token);
              }
              break;
            }
            case 'tool_call': {
              if (event.toolCall) {
                const tc: ToolCall = {
                  id: event.toolCall.id ?? createId('tool'),
                  name: event.toolCall.name,
                  arguments: event.toolCall.arguments ?? {},
                };
                toolCalls.push(tc);
                callbacks.onToolCall?.(tc);
              }
              break;
            }
            case 'usage': {
              usage = event.usage;
              if (usage) {
                callbacks.onUsage?.(usage);
              }
              break;
            }
            case 'error': {
              const errText = extractStreamErrorMessage(event);
              throw new ProviderError(errText, {
                retryable: event.retryable ?? true,
              });
            }
            case 'done': {
              if (event.message?.content) {
                content = event.message.content;
              }
              if (event.usage) {
                usage = event.usage;
              }
              if (event.model) {
                model = event.model;
              }
              finishReason =
                event.finishReason ??
                (toolCalls.length > 0 ? 'tool_calls' : 'stop');
              break;
            }
            default:
              break;
          }
        }
      }
    } catch (error) {
      throw this.mapFetchError(error);
    } finally {
      cancelReader();
    }

    const message: Message = {
      id: createId('msg'),
      role: 'assistant',
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      createdAt: Date.now(),
      meta: { requestId: request.requestId },
    };
    callbacks.onMessage?.(message);

    return {
      message,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
      model,
      finishReason: toolCalls.length > 0 ? 'tool_calls' : finishReason,
    };
  }

  private async resolveHeaders(): Promise<Record<string, string>> {
    if (!this.headers) {
      return {};
    }
    if (typeof this.headers === 'function') {
      return (await this.headers()) ?? {};
    }
    return this.headers;
  }

  private async mapHttpError(response: Response): Promise<ProviderError> {
    let message = `Gateway request failed with status ${response.status}`;
    let retryable = response.status >= 500 || response.status === 429;
    try {
      const body = (await response.json()) as GatewayResponseBody;
      if (body.error?.message) {
        message = body.error.message;
      }
      if (typeof body.error?.retryable === 'boolean') {
        retryable = body.error.retryable;
      }
    } catch {
      // ignore parse failures
    }
    return new ProviderError(message, {
      retryable,
      details: { status: response.status },
    });
  }

  private mapFetchError(error: unknown): never {
    if (error instanceof CancellationError || (error instanceof Error && error.name === 'AbortError')) {
      throw new CancellationError();
    }
    if (error instanceof ProviderError) {
      throw error;
    }
    const normalized = toAIAssistantError(error);
    throw new ProviderError(normalized.message || 'Gateway request failed', {
      cause: error,
      retryable: true,
    });
  }
}

interface StreamEvent {
  type: string;
  token?: string;
  toolCall?: {
    id?: string;
    name: string;
    arguments?: Record<string, unknown>;
  };
  usage?: TokenUsage;
  /** Final assistant message payload on `done` events. */
  message?: { content?: string };
  /** Error text on `error` events. */
  errorMessage?: string;
  finishReason?: AIResponse['finishReason'];
  model?: string;
  retryable?: boolean;
}

function parseStreamLine(line: string): StreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === 'data: [DONE]') {
    return null;
  }

  let payload = trimmed;
  if (payload.startsWith('data:')) {
    payload = payload.slice(5).trim();
  }
  if (!payload || payload === '[DONE]') {
    return null;
  }

  try {
    return JSON.parse(payload) as StreamEvent;
  } catch {
    return null;
  }
}

function extractStreamErrorMessage(event: StreamEvent): string {
  const raw = event as StreamEvent & { message?: unknown };
  if (typeof raw.errorMessage === 'string') {
    return raw.errorMessage;
  }
  if (typeof raw.message === 'string') {
    return raw.message;
  }
  return 'Gateway stream error';
}

function serializeMessage(message: Message): Record<string, unknown> {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    toolCalls: message.toolCalls,
    toolResult: message.toolResult,
    createdAt: message.createdAt,
  };
}
