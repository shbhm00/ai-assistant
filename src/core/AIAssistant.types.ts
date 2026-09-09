import type {
  AILogger,
  Environment,
  Message,
  RetryConfig,
  SecurityConfig,
  SessionDefaults,
  ContextDefaults,
} from '../core/types';
import type { AIProvider, AIRequest, AIResponse } from '../providers/AIProvider';
import type { AIAssistantObserver } from '../observability/Observer';
import type { ToolDefinition } from '../tools/types';
import type { ContextProviderDefinition } from '../context/types';
import type { AISession, SessionOptions } from '../session/types';
import type { SensitiveDataFilter } from '../security/SensitiveDataFilter';
import type { ToolRegistry } from '../tools/ToolRegistry';
import type { ContextRegistry } from '../context/ContextRegistry';
import type { ToolExecutor } from '../tools/ToolExecutor';

export interface AIAssistantConfig {
  provider: AIProvider;
  fallbackProvider?: AIProvider;
  environment?: Environment;
  timeoutMs?: number;
  retry?: Partial<RetryConfig>;
  security?: Partial<SecurityConfig>;
  session?: Partial<SessionDefaults>;
  context?: Partial<ContextDefaults>;
  observer?: AIAssistantObserver;
  logger?: AILogger;
  /** Default model hint forwarded to the provider/gateway. */
  model?: string;
}

export interface ResolvedAIAssistantConfig {
  environment: Environment;
  timeoutMs: number;
  retry: RetryConfig;
  security: SecurityConfig;
  session: SessionDefaults;
  context: ContextDefaults;
  model?: string;
}

export interface AIAssistant {
  registerTool(tool: ToolDefinition): void;
  unregisterTool(name: string): boolean;
  registerContextProvider(provider: ContextProviderDefinition): void;
  unregisterContextProvider(name: string): boolean;
  setContextProviderEnabled(name: string, enabled: boolean): void;
  createSession(options?: SessionOptions): AISession;
  getConfig(): Readonly<ResolvedAIAssistantConfig>;
  dispose(): void;
}

/** Internal dependencies shared with AISessionImpl. */
export interface AssistantRuntime {
  provider: AIProvider;
  fallbackProvider?: AIProvider;
  config: ResolvedAIAssistantConfig;
  tools: ToolRegistry;
  contexts: ContextRegistry;
  toolExecutor: ToolExecutor;
  filter: SensitiveDataFilter;
  observer: AIAssistantObserver;
  logger: AILogger;
  buildRequest: (input: {
    requestId: string;
    sessionId: string;
    messages: Message[];
    metadata?: Record<string, unknown>;
  }) => Promise<AIRequest>;
  invokeProvider: (input: {
    request: AIRequest;
    streaming: boolean;
    signal?: AbortSignal;
    onToken?: (token: string) => void;
    onToolCall?: (toolCall: NonNullable<AIResponse['toolCalls']>[number]) => void;
  }) => Promise<AIResponse>;
}
