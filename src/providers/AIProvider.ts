import type {
  Message,
  TokenUsage,
  ToolCall,
  JSONSchema,
} from '../core/types';

export interface ProviderToolDefinition {
  name: string;
  description: string;
  inputSchema?: JSONSchema;
}

export interface AIRequest {
  requestId: string;
  sessionId: string;
  messages: Message[];
  tools?: ProviderToolDefinition[];
  /** Redacted merged application context. */
  context?: Record<string, unknown>;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface AIResponse {
  message: Message;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  model?: string;
  raw?: unknown;
  finishReason?: 'stop' | 'tool_calls' | 'length' | 'cancelled' | 'error';
}

export interface StreamCallbacks {
  onToken?: (token: string) => void;
  onToolCall?: (toolCall: ToolCall) => void;
  onMessage?: (message: Message) => void;
  onUsage?: (usage: TokenUsage) => void;
}

/**
 * Provider-agnostic AI interface.
 * Core SDK must not depend on OpenAI, Anthropic, Gemini, or any vendor SDK.
 */
export interface AIProvider {
  readonly name: string;
  generateResponse(
    request: AIRequest,
    signal?: AbortSignal
  ): Promise<AIResponse>;
  streamResponse(
    request: AIRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<AIResponse>;
}
