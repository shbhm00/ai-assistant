import type { JSONSchema } from '../core/types';

export interface ToolExecutionContext {
  signal?: AbortSignal;
  sessionId: string;
  toolCallId: string;
}

export interface ToolDefinition<TInput = Record<string, unknown>, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema?: JSONSchema;
  timeoutMs?: number;
  execute: (
    input: TInput,
    ctx: ToolExecutionContext
  ) => Promise<TOutput> | TOutput;
}

export interface RegisteredTool {
  definition: ToolDefinition;
  registeredAt: number;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  toolCallId: string;
  name: string;
  content: unknown;
  isError: boolean;
  durationMs: number;
}
