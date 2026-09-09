/**
 * Shared JSON-schema-ish types and message/tool shapes used across the SDK.
 */

export type JSONSchemaType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null';

export interface JSONSchema {
  type?: JSONSchemaType | JSONSchemaType[];
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema | JSONSchema[];
  additionalProperties?: boolean | JSONSchema;
  description?: string;
  enum?: unknown[];
  [key: string]: unknown;
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultMessage {
  toolCallId: string;
  name: string;
  content: unknown;
  isError?: boolean;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolResult?: ToolResultMessage;
  createdAt: number;
  meta?: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type Environment = 'development' | 'staging' | 'production';

export type BackoffStrategy = 'exponential' | 'linear' | 'none';

export interface RetryConfig {
  maxRetries: number;
  backoff: BackoffStrategy;
  initialDelayMs: number;
  maxDelayMs: number;
}

export interface SecurityConfig {
  blockedFields: string[];
  /** Optional custom redactor; return value replaces the field value. */
  customRedactor?: (value: unknown, path: string, key: string) => unknown | undefined;
}

export interface SessionDefaults {
  maxHistoryMessages: number;
  maxToolRounds: number;
}

export interface ContextDefaults {
  maxTotalBytes: number;
}

export interface AILogger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}
