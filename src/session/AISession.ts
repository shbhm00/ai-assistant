import type { Message, TokenUsage } from '../core/types';
import type { AIRequest, AIResponse } from '../providers/AIProvider';
import {
  AIAssistantError,
  CancellationError,
  toAIAssistantError,
} from '../errors/errors';
import { createId } from '../utils/id';
import { createCancelScope } from '../utils/cancellation';
import type { AssistantRuntime } from '../core/AIAssistant.types';
import type {
  AISession,
  SendMessageOptions,
  SessionOptions,
  StreamHandle,
  StreamMessageCallbacks,
} from './types';
import type { ToolCallResult } from '../tools/types';

export class AISessionImpl implements AISession {
  private readonly id: string;
  private readonly maxHistoryMessages: number;
  private readonly maxToolRounds: number;
  private readonly metadata: Record<string, unknown>;
  private history: Message[] = [];

  constructor(
    private readonly runtime: AssistantRuntime,
    options: SessionOptions = {}
  ) {
    this.id = options.id ?? createId('session');
    this.maxHistoryMessages =
      options.maxHistoryMessages ?? runtime.config.session.maxHistoryMessages;
    this.maxToolRounds =
      options.maxToolRounds ?? runtime.config.session.maxToolRounds;
    this.metadata = { ...(options.metadata ?? {}) };
  }

  getId(): string {
    return this.id;
  }

  getMetadata(): Record<string, unknown> {
    return { ...this.metadata };
  }

  getHistory(): Message[] {
    return this.history.map((m) => ({ ...m }));
  }

  clear(): void {
    this.history = [];
  }

  async sendMessage(
    content: string,
    options: SendMessageOptions = {}
  ): Promise<AIResponse> {
    return this.runTurn(content, options, undefined);
  }

  streamMessage(
    content: string,
    callbacks: StreamMessageCallbacks = {},
    options: SendMessageOptions = {}
  ): StreamHandle {
    const scope = createCancelScope(options.signal);
    let cancelled = false;

    const promise = this.runTurn(
      content,
      { ...options, signal: scope.signal },
      callbacks
    )
      .then((response) => {
        callbacks.onComplete?.(response);
        return response;
      })
      .catch((error: unknown) => {
        const normalized = toAIAssistantError(error);
        callbacks.onError?.(normalized);
        throw normalized;
      });

    return {
      promise,
      cancel: (reason?: string) => {
        cancelled = true;
        scope.cancel(reason);
      },
      get cancelled() {
        return cancelled || scope.isCancelled();
      },
    };
  }

  private async runTurn(
    content: string,
    options: SendMessageOptions,
    callbacks: StreamMessageCallbacks | undefined
  ): Promise<AIResponse> {
    const requestId = createId('req');
    const startedAt = Date.now();
    const streaming = Boolean(callbacks);

    this.append({
      id: createId('msg'),
      role: 'user',
      content,
      createdAt: Date.now(),
    });

    this.runtime.observer.onRequestStart?.({
      requestId,
      sessionId: this.id,
      provider: this.runtime.provider.name,
      model: this.runtime.config.model,
      streaming,
      toolCount: this.runtime.tools.size,
      startedAt,
    });

    if (streaming) {
      this.runtime.observer.onStreamStart?.({
        requestId,
        sessionId: this.id,
        provider: this.runtime.provider.name,
        startedAt,
      });
    }

    let tokenCount = 0;
    let toolRounds = 0;
    let lastResponse: AIResponse | undefined;

    try {
      for (let round = 0; round <= this.maxToolRounds; round++) {
        const request = await this.runtime.buildRequest({
          requestId,
          sessionId: this.id,
          messages: this.history,
          metadata: options.metadata,
        });

        lastResponse = await this.runtime.invokeProvider({
          request,
          streaming: streaming && round === 0,
          signal: options.signal,
          onToken: (token) => {
            tokenCount += 1;
            callbacks?.onToken?.(token);
          },
          onToolCall: (toolCall) => {
            callbacks?.onToolCall?.(toolCall);
          },
        });

        this.append(lastResponse.message);

        const toolCalls = lastResponse.toolCalls ?? lastResponse.message.toolCalls;
        if (!toolCalls || toolCalls.length === 0) {
          break;
        }

        if (round === this.maxToolRounds) {
          throw new AIAssistantError({
            code: 'AI_MAX_TOOL_ROUNDS',
            message: `Exceeded maxToolRounds (${this.maxToolRounds})`,
            retryable: false,
            details: { maxToolRounds: this.maxToolRounds },
          });
        }

        toolRounds += 1;

        for (const call of toolCalls) {
          this.runtime.observer.onToolStart?.({
            requestId,
            sessionId: this.id,
            toolName: call.name,
            toolCallId: call.id,
            startedAt: Date.now(),
          });

          let result: ToolCallResult;
          try {
            result = await this.runtime.toolExecutor.execute(call, {
              sessionId: this.id,
              signal: options.signal,
            });
            // Redact tool output before it re-enters the conversation.
            result = {
              ...result,
              content: this.runtime.filter.redact(result.content),
            };
            this.runtime.observer.onToolComplete?.({
              requestId,
              sessionId: this.id,
              toolName: call.name,
              toolCallId: call.id,
              startedAt: startedAt,
              durationMs: result.durationMs,
              success: !result.isError,
              errorCode: result.isError ? 'AI_TOOL_EXECUTION_ERROR' : undefined,
            });
          } catch (error) {
            const normalized = toAIAssistantError(error);
            this.runtime.observer.onToolComplete?.({
              requestId,
              sessionId: this.id,
              toolName: call.name,
              toolCallId: call.id,
              startedAt,
              durationMs: 0,
              success: false,
              errorCode: normalized.code,
            });
            result = {
              toolCallId: call.id,
              name: call.name,
              content: { error: normalized.message, code: normalized.code },
              isError: true,
              durationMs: 0,
            };
          }

          callbacks?.onToolResult?.(result);

          this.append({
            id: createId('msg'),
            role: 'tool',
            content:
              typeof result.content === 'string'
                ? result.content
                : JSON.stringify(result.content),
            toolResult: {
              toolCallId: result.toolCallId,
              name: result.name,
              content: result.content,
              isError: result.isError,
            },
            createdAt: Date.now(),
          });
        }
      }

      const response = lastResponse!;
      const latencyMs = Date.now() - startedAt;

      this.runtime.observer.onRequestComplete?.({
        requestId,
        sessionId: this.id,
        provider: this.runtime.provider.name,
        model: response.model ?? this.runtime.config.model,
        streaming,
        toolCount: this.runtime.tools.size,
        startedAt,
        latencyMs,
        success: true,
        toolRounds,
        usage: response.usage,
      });

      if (streaming) {
        this.runtime.observer.onStreamComplete?.({
          requestId,
          sessionId: this.id,
          provider: this.runtime.provider.name,
          startedAt,
          durationMs: latencyMs,
          tokenCount,
          cancelled: false,
        });
      }

      return response;
    } catch (error) {
      const normalized = toAIAssistantError(error);
      const latencyMs = Date.now() - startedAt;
      const cancelled = normalized instanceof CancellationError;

      this.runtime.observer.onRequestError?.({
        requestId,
        sessionId: this.id,
        provider: this.runtime.provider.name,
        model: this.runtime.config.model,
        streaming,
        toolCount: this.runtime.tools.size,
        startedAt,
        latencyMs,
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
      });

      if (streaming) {
        this.runtime.observer.onStreamComplete?.({
          requestId,
          sessionId: this.id,
          provider: this.runtime.provider.name,
          startedAt,
          durationMs: latencyMs,
          tokenCount,
          cancelled,
        });
      }

      throw normalized;
    }
  }

  private append(message: Message): void {
    this.history.push(message);
    if (this.history.length > this.maxHistoryMessages) {
      const overflow = this.history.length - this.maxHistoryMessages;
      this.history = this.history.slice(overflow);
    }
  }
}

export type { TokenUsage, AIRequest };
