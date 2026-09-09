/**
 * Typed SDK errors for @company/react-native-ai-assistant.
 * Errors are actionable: code + message + retryable (+ optional cause).
 */

export type AIAssistantErrorCode =
  | 'AI_ASSISTANT_ERROR'
  | 'AI_PROVIDER_ERROR'
  | 'AI_PROVIDER_TIMEOUT'
  | 'AI_TOOL_EXECUTION_ERROR'
  | 'AI_TOOL_VALIDATION_ERROR'
  | 'AI_TOOL_NOT_FOUND'
  | 'AI_CONTEXT_PROVIDER_ERROR'
  | 'AI_TIMEOUT'
  | 'AI_CANCELLED'
  | 'AI_SECURITY_ERROR'
  | 'AI_CONFIGURATION_ERROR'
  | 'AI_MAX_TOOL_ROUNDS'
  | 'AI_MALFORMED_RESPONSE';

export interface AIAssistantErrorOptions {
  code?: AIAssistantErrorCode;
  message: string;
  retryable?: boolean;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class AIAssistantError extends Error {
  readonly code: AIAssistantErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;

  constructor(options: AIAssistantErrorOptions) {
    super(options.message);
    this.name = 'AIAssistantError';
    this.code = options.code ?? 'AI_ASSISTANT_ERROR';
    this.retryable = options.retryable ?? false;
    this.cause = options.cause;
    this.details = options.details;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

export class ProviderError extends AIAssistantError {
  constructor(
    message: string,
    options: Omit<AIAssistantErrorOptions, 'message' | 'code'> & {
      code?: AIAssistantErrorCode;
    } = {}
  ) {
    super({
      ...options,
      code: options.code ?? 'AI_PROVIDER_ERROR',
      message,
      retryable: options.retryable ?? true,
    });
    this.name = 'ProviderError';
  }
}

export class ToolExecutionError extends AIAssistantError {
  constructor(
    message: string,
    options: Omit<AIAssistantErrorOptions, 'message' | 'code'> = {}
  ) {
    super({
      ...options,
      code: 'AI_TOOL_EXECUTION_ERROR',
      message,
      retryable: options.retryable ?? false,
    });
    this.name = 'ToolExecutionError';
  }
}

export class ToolValidationError extends AIAssistantError {
  constructor(
    message: string,
    options: Omit<AIAssistantErrorOptions, 'message' | 'code'> = {}
  ) {
    super({
      ...options,
      code: 'AI_TOOL_VALIDATION_ERROR',
      message,
      retryable: false,
    });
    this.name = 'ToolValidationError';
  }
}

export class ToolNotFoundError extends AIAssistantError {
  constructor(toolName: string) {
    super({
      code: 'AI_TOOL_NOT_FOUND',
      message: `Tool "${toolName}" is not registered`,
      retryable: false,
      details: { toolName },
    });
    this.name = 'ToolNotFoundError';
  }
}

export class ContextProviderError extends AIAssistantError {
  constructor(
    message: string,
    options: Omit<AIAssistantErrorOptions, 'message' | 'code'> = {}
  ) {
    super({
      ...options,
      code: 'AI_CONTEXT_PROVIDER_ERROR',
      message,
      retryable: options.retryable ?? false,
    });
    this.name = 'ContextProviderError';
  }
}

export class TimeoutError extends AIAssistantError {
  constructor(
    message = 'AI provider request timed out',
    options: Omit<AIAssistantErrorOptions, 'message' | 'code'> = {}
  ) {
    super({
      ...options,
      code: options.details?.kind === 'provider' ? 'AI_PROVIDER_TIMEOUT' : 'AI_TIMEOUT',
      message,
      retryable: true,
    });
    this.name = 'TimeoutError';
  }
}

export class CancellationError extends AIAssistantError {
  constructor(message = 'Request was cancelled') {
    super({
      code: 'AI_CANCELLED',
      message,
      retryable: false,
    });
    this.name = 'CancellationError';
  }
}

export class SecurityError extends AIAssistantError {
  constructor(
    message: string,
    options: Omit<AIAssistantErrorOptions, 'message' | 'code'> = {}
  ) {
    super({
      ...options,
      code: 'AI_SECURITY_ERROR',
      message,
      retryable: false,
    });
    this.name = 'SecurityError';
  }
}

export class ConfigurationError extends AIAssistantError {
  constructor(
    message: string,
    options: Omit<AIAssistantErrorOptions, 'message' | 'code'> = {}
  ) {
    super({
      ...options,
      code: 'AI_CONFIGURATION_ERROR',
      message,
      retryable: false,
    });
    this.name = 'ConfigurationError';
  }
}

export function isAIAssistantError(error: unknown): error is AIAssistantError {
  return error instanceof AIAssistantError;
}

export function isRetryableError(error: unknown): boolean {
  if (isAIAssistantError(error)) {
    return error.retryable;
  }
  return false;
}

export function toAIAssistantError(error: unknown): AIAssistantError {
  if (isAIAssistantError(error)) {
    return error;
  }
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return new CancellationError(error.message || 'Request was cancelled');
    }
    return new AIAssistantError({
      message: error.message,
      cause: error,
      retryable: false,
    });
  }
  return new AIAssistantError({
    message: String(error),
    cause: error,
    retryable: false,
  });
}
