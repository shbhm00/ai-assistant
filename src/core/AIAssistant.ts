import type {
  AILogger,
  Message,
  RetryConfig,
} from './types';
import type {
  AIAssistant,
  AIAssistantConfig,
  AssistantRuntime,
  ResolvedAIAssistantConfig,
} from './AIAssistant.types';
import { ConfigurationError, ProviderError, toAIAssistantError } from '../errors/errors';
import { DEFAULT_BLOCKED_FIELDS, SensitiveDataFilter } from '../security/SensitiveDataFilter';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ToolExecutor } from '../tools/ToolExecutor';
import { ContextRegistry } from '../context/ContextRegistry';
import { composeObservers, noopObserver } from '../observability/Observer';
import type { AIProvider, AIRequest, AIResponse, StreamCallbacks } from '../providers/AIProvider';
import { AISessionImpl } from '../session/AISession';
import type { SessionOptions } from '../session/types';
import type { ToolDefinition } from '../tools/types';
import type { ContextProviderDefinition } from '../context/types';
import { withRetry } from '../utils/retry';
import { withTimeout } from '../utils/timeout';
import { createId } from '../utils/id';

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 2,
  backoff: 'exponential',
  initialDelayMs: 300,
  maxDelayMs: 5_000,
};

const silentLogger: AILogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Creates a framework-agnostic AI Assistant instance.
 * Works without React. React hooks are an optional adapter layer.
 */
export function createAIAssistant(config: AIAssistantConfig): AIAssistant {
  if (!config?.provider) {
    throw new ConfigurationError('createAIAssistant requires a provider');
  }

  const resolved = resolveConfig(config);
  const filter = new SensitiveDataFilter({
    blockedFields: resolved.security.blockedFields,
    customRedactor: resolved.security.customRedactor,
  });
  const tools = new ToolRegistry();
  const contexts = new ContextRegistry({
    maxTotalBytes: resolved.context.maxTotalBytes,
  });
  const toolExecutor = new ToolExecutor(tools);
  const observer = composeObservers(config.observer);
  const logger = config.logger ?? silentLogger;
  let disposed = false;

  const runtime: AssistantRuntime = {
    provider: config.provider,
    fallbackProvider: config.fallbackProvider,
    config: resolved,
    tools,
    contexts,
    toolExecutor,
    filter,
    observer,
    logger,
    buildRequest: async ({ requestId, sessionId, messages, metadata }) => {
      const collected = await contexts.collect();
      if (collected.errors.length > 0) {
        logger.warn('One or more context providers failed', {
          errors: collected.errors,
        });
      }

      const redactedContext = filter.redact({
        ...collected.byProvider,
        _meta: {
          truncatedProviders: collected.truncatedProviders,
          contextErrors: collected.errors.map((e) => e.provider),
        },
      });

      const redactedMessages = messages.map((m) => redactMessage(m, filter));

      const request: AIRequest = {
        requestId,
        sessionId,
        messages: redactedMessages,
        tools: tools.toProviderTools(),
        context: redactedContext,
        model: resolved.model,
        metadata: metadata ? filter.redact(metadata) : undefined,
      };
      return request;
    },
    invokeProvider: async ({ request, streaming, signal, onToken, onToolCall }) => {
      return invokeWithResilience({
        primary: config.provider,
        fallback: config.fallbackProvider,
        request,
        streaming,
        signal,
        timeoutMs: resolved.timeoutMs,
        retry: resolved.retry,
        onToken,
        onToolCall,
        logger,
      });
    },
  };

  const assertActive = () => {
    if (disposed) {
      throw new ConfigurationError('AIAssistant has been disposed');
    }
  };

  return {
    registerTool(tool: ToolDefinition) {
      assertActive();
      tools.register(tool);
    },
    unregisterTool(name: string) {
      assertActive();
      return tools.unregister(name);
    },
    registerContextProvider(provider: ContextProviderDefinition) {
      assertActive();
      contexts.register(provider);
    },
    unregisterContextProvider(name: string) {
      assertActive();
      return contexts.unregister(name);
    },
    setContextProviderEnabled(name: string, enabled: boolean) {
      assertActive();
      contexts.setEnabled(name, enabled);
    },
    createSession(options?: SessionOptions) {
      assertActive();
      return new AISessionImpl(runtime, options);
    },
    getConfig() {
      return { ...resolved, retry: { ...resolved.retry }, security: { ...resolved.security }, session: { ...resolved.session }, context: { ...resolved.context } };
    },
    dispose() {
      disposed = true;
      tools.clear();
      contexts.clear();
    },
  };
}

function resolveConfig(config: AIAssistantConfig): ResolvedAIAssistantConfig {
  return {
    environment: config.environment ?? 'development',
    timeoutMs: config.timeoutMs ?? 30_000,
    retry: {
      ...DEFAULT_RETRY,
      ...config.retry,
    },
    security: {
      blockedFields: [
        ...DEFAULT_BLOCKED_FIELDS,
        ...(config.security?.blockedFields ?? []),
      ],
      customRedactor: config.security?.customRedactor,
    },
    session: {
      maxHistoryMessages: config.session?.maxHistoryMessages ?? 50,
      maxToolRounds: config.session?.maxToolRounds ?? 5,
    },
    context: {
      maxTotalBytes: config.context?.maxTotalBytes ?? 32_768,
    },
    model: config.model,
  };
}

function redactMessage(message: Message, filter: SensitiveDataFilter): Message {
  return {
    ...message,
    content: message.content, // plain user text; field-level redaction applies to structured payloads
    toolCalls: message.toolCalls
      ? message.toolCalls.map((tc) => ({
          ...tc,
          arguments: filter.redact(tc.arguments),
        }))
      : undefined,
    toolResult: message.toolResult
      ? {
          ...message.toolResult,
          content: filter.redact(message.toolResult.content),
        }
      : undefined,
    meta: message.meta ? filter.redact(message.meta) : undefined,
  };
}

async function invokeWithResilience(input: {
  primary: AIProvider;
  fallback?: AIProvider;
  request: AIRequest;
  streaming: boolean;
  signal?: AbortSignal;
  timeoutMs: number;
  retry: RetryConfig;
  onToken?: StreamCallbacks['onToken'];
  onToolCall?: StreamCallbacks['onToolCall'];
  logger: AILogger;
}): Promise<AIResponse> {
  const providers = [input.primary, input.fallback].filter(Boolean) as AIProvider[];
  let lastError: unknown;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i]!;
    const isLast = i === providers.length - 1;

    try {
      return await withRetry(
        async () =>
          withTimeout(
            async (signal) => {
              if (input.streaming) {
                return provider.streamResponse(
                  input.request,
                  {
                    onToken: input.onToken,
                    onToolCall: input.onToolCall,
                  },
                  signal
                );
              }
              return provider.generateResponse(input.request, signal);
            },
            {
              timeoutMs: input.timeoutMs,
              signal: input.signal,
              message: `AI provider "${provider.name}" timed out`,
            }
          ),
        {
          ...input.retry,
          signal: input.signal,
          onRetry: ({ attempt, delayMs, error }) => {
            input.logger.warn('Retrying AI provider request', {
              provider: provider.name,
              attempt,
              delayMs,
              code: toAIAssistantError(error).code,
            });
          },
        }
      );
    } catch (error) {
      lastError = error;
      input.logger.error('AI provider invocation failed', {
        provider: provider.name,
        code: toAIAssistantError(error).code,
        fallback: !isLast,
      });
      if (isLast) {
        break;
      }
    }
  }

  throw toAIAssistantError(
    lastError ??
      new ProviderError('All AI providers failed', { retryable: false })
  );
}

export { createId, noopObserver };
