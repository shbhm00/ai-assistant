import type { Message } from '../core/types';
import type { AIResponse } from '../providers/AIProvider';
import type { AIAssistantError } from '../errors/errors';
import type { ToolCall } from '../core/types';
import type { ToolCallResult } from '../tools/types';

export interface SessionOptions {
  id?: string;
  maxHistoryMessages?: number;
  maxToolRounds?: number;
  metadata?: Record<string, unknown>;
}

export interface SendMessageOptions {
  signal?: AbortSignal;
  /** Extra per-request metadata (non-sensitive). */
  metadata?: Record<string, unknown>;
}

export interface StreamMessageCallbacks {
  onToken?: (token: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onToolResult?: (result: ToolCallResult) => void;
  onComplete?: (response: AIResponse) => void;
  onError?: (error: AIAssistantError) => void;
}

export interface StreamHandle {
  /** Resolves when streaming completes successfully; rejects on error/cancel. */
  promise: Promise<AIResponse>;
  cancel: (reason?: string) => void;
  readonly cancelled: boolean;
}

export interface AISession {
  getId(): string;
  sendMessage(content: string, options?: SendMessageOptions): Promise<AIResponse>;
  streamMessage(
    content: string,
    callbacks?: StreamMessageCallbacks,
    options?: SendMessageOptions
  ): StreamHandle;
  getHistory(): Message[];
  clear(): void;
  getMetadata(): Record<string, unknown>;
}
