// Core
export { createAIAssistant } from './core/AIAssistant';
export type {
  AIAssistant,
  AIAssistantConfig,
  ResolvedAIAssistantConfig,
} from './core/AIAssistant.types';
export type {
  Environment,
  Message,
  MessageRole,
  ToolCall,
  TokenUsage,
  JSONSchema,
  RetryConfig,
  SecurityConfig,
  AILogger,
  BackoffStrategy,
} from './core/types';

// Session
export type {
  AISession,
  SessionOptions,
  StreamHandle,
  StreamMessageCallbacks,
  SendMessageOptions,
} from './session/types';

// Providers
export type {
  AIProvider,
  AIRequest,
  AIResponse,
  StreamCallbacks,
  ProviderToolDefinition,
} from './providers/AIProvider';
export { MockAIProvider } from './providers/MockAIProvider';
export type {
  MockAIProviderOptions,
  MockScenario,
} from './providers/MockAIProvider';
export { HttpGatewayProvider } from './providers/HttpGatewayProvider';
export type { HttpGatewayProviderOptions } from './providers/HttpGatewayProvider';

// Tools
export { ToolRegistry } from './tools/ToolRegistry';
export { ToolExecutor, validateAgainstSchema, coerceValueToSchema } from './tools/ToolExecutor';
export type {
  ToolDefinition,
  ToolExecutionContext,
  ToolCallRequest,
  ToolCallResult,
} from './tools/types';

// Context
export { ContextRegistry } from './context/ContextRegistry';
export type {
  ContextProviderDefinition,
  CollectedContext,
} from './context/types';

// Security
export {
  SensitiveDataFilter,
  createSensitiveDataFilter,
  DEFAULT_BLOCKED_FIELDS,
} from './security/SensitiveDataFilter';

// Observability
export { composeObservers, noopObserver } from './observability/Observer';
export type {
  AIAssistantObserver,
  ObserverRequestEvent,
  ObserverRequestCompleteEvent,
  ObserverRequestErrorEvent,
  ObserverToolEvent,
  ObserverToolCompleteEvent,
  ObserverStreamEvent,
  ObserverStreamCompleteEvent,
} from './observability/Observer';

// Errors
export {
  AIAssistantError,
  ProviderError,
  ToolExecutionError,
  ToolValidationError,
  ToolNotFoundError,
  ContextProviderError,
  TimeoutError,
  CancellationError,
  SecurityError,
  ConfigurationError,
  isAIAssistantError,
  isRetryableError,
  toAIAssistantError,
} from './errors/errors';
export type { AIAssistantErrorCode, AIAssistantErrorOptions } from './errors/errors';

// Utils (advanced)
export { withRetry, computeBackoffDelay } from './utils/retry';
export { withTimeout } from './utils/timeout';
export { createCancelScope } from './utils/cancellation';
