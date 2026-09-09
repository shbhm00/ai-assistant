import type { Message, ToolCall } from '../core/types';
import { CancellationError, ProviderError } from '../errors/errors';
import { createId } from '../utils/id';
import { throwIfAborted } from '../utils/cancellation';
import type {
  AIProvider,
  AIRequest,
  AIResponse,
  StreamCallbacks,
} from './AIProvider';

export type MockScenario =
  | { type: 'text'; content: string; delayMs?: number }
  | {
      type: 'tool_calls';
      toolCalls: Array<{ name: string; arguments?: Record<string, unknown> }>;
      /** Optional assistant text accompanying the tool call turn. */
      content?: string;
      delayMs?: number;
    }
  | { type: 'error'; message: string; retryable?: boolean; delayMs?: number };

export interface MockAIProviderOptions {
  /** Simple FIFO text responses (converted to text scenarios). */
  responses?: string[];
  /** Explicit multi-turn / tool-call scenarios for deterministic tests. */
  scenarios?: MockScenario[];
  /** Delay between streamed tokens (ms). */
  streamTokenDelayMs?: number;
  model?: string;
  /** When true, scenarios repeat forever instead of exhausting. */
  loop?: boolean;
}

/**
 * Deterministic provider for local development and unit tests.
 * Supports scripted tool-calling without network access.
 */
export class MockAIProvider implements AIProvider {
  readonly name = 'mock';
  private readonly queue: MockScenario[];
  private readonly streamTokenDelayMs: number;
  private readonly model: string;
  private readonly loop: boolean;
  private cursor = 0;

  constructor(options: MockAIProviderOptions = {}) {
    const fromResponses = (options.responses ?? []).map<MockScenario>((content) => ({
      type: 'text',
      content,
    }));
    this.queue = [...fromResponses, ...(options.scenarios ?? [])];
    this.streamTokenDelayMs = options.streamTokenDelayMs ?? 0;
    this.model = options.model ?? 'mock-model';
    this.loop = options.loop ?? false;
  }

  /** Enqueue additional scenarios at runtime. */
  enqueue(...scenarios: MockScenario[]): void {
    this.queue.push(...scenarios);
  }

  reset(): void {
    this.cursor = 0;
  }

  async generateResponse(
    request: AIRequest,
    signal?: AbortSignal
  ): Promise<AIResponse> {
    return this.run(request, signal, undefined);
  }

  async streamResponse(
    request: AIRequest,
    callbacks: StreamCallbacks,
    signal?: AbortSignal
  ): Promise<AIResponse> {
    return this.run(request, signal, callbacks);
  }

  private async run(
    request: AIRequest,
    signal: AbortSignal | undefined,
    callbacks: StreamCallbacks | undefined
  ): Promise<AIResponse> {
    throwIfAborted(signal);
    const scenario = this.nextScenario(request);

    if (scenario.delayMs) {
      await delay(scenario.delayMs, signal);
    }

    if (scenario.type === 'error') {
      throw new ProviderError(scenario.message, {
        retryable: scenario.retryable ?? true,
      });
    }

    if (scenario.type === 'tool_calls') {
      const toolCalls: ToolCall[] = scenario.toolCalls.map((tc) => ({
        id: createId('tool'),
        name: tc.name,
        arguments: tc.arguments ?? {},
      }));

      for (const tc of toolCalls) {
        callbacks?.onToolCall?.(tc);
      }

      const message = createAssistantMessage(scenario.content ?? '', toolCalls);
      callbacks?.onMessage?.(message);

      return {
        message,
        toolCalls,
        model: this.model,
        finishReason: 'tool_calls',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    }

    const content = scenario.content;
    if (callbacks?.onToken) {
      await streamTokens(content, callbacks.onToken, this.streamTokenDelayMs, signal);
    }

    const message = createAssistantMessage(content);
    callbacks?.onMessage?.(message);
    callbacks?.onUsage?.({ promptTokens: 8, completionTokens: content.length, totalTokens: 8 + content.length });

    return {
      message,
      model: this.model,
      finishReason: 'stop',
      usage: {
        promptTokens: 8,
        completionTokens: Math.ceil(content.length / 4),
        totalTokens: 8 + Math.ceil(content.length / 4),
      },
    };
  }

  private nextScenario(request?: AIRequest): MockScenario {
    if (this.queue.length === 0) {
      return this.buildDefaultScenario(request);
    }

    if (this.cursor >= this.queue.length) {
      if (this.loop) {
        this.cursor = 0;
      } else {
        return this.buildDefaultScenario(request);
      }
    }

    const scenario = this.queue[this.cursor]!;
    this.cursor += 1;
    return scenario;
  }

  private buildDefaultScenario(request?: AIRequest): MockScenario {
    const tools = request?.tools ?? [];
    const lastUser = [...(request?.messages ?? [])]
      .reverse()
      .find((m) => m.role === 'user');
    const hasToolResult = (request?.messages ?? []).some((m) => m.role === 'tool');

    if (tools.length > 0 && !hasToolResult) {
      return {
        type: 'tool_calls',
        toolCalls: tools.slice(0, 3).map((tool) => ({
          name: tool.name,
          arguments: {},
        })),
      };
    }

    return {
      type: 'text',
      content:
        `Mock response` +
        (lastUser?.content ? ` for: "${String(lastUser.content).slice(0, 120)}"` : '') +
        `. Tools available: ${tools.map((t) => t.name).join(', ') || 'none'}.`,
    };
  }
}

function createAssistantMessage(content: string, toolCalls?: ToolCall[]): Message {
  return {
    id: createId('msg'),
    role: 'assistant',
    content,
    toolCalls,
    createdAt: Date.now(),
  };
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    throwIfAborted(signal);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(new CancellationError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new CancellationError());
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function streamTokens(
  content: string,
  onToken: (token: string) => void,
  delayMs: number,
  signal?: AbortSignal
): Promise<void> {
  const parts = content.split(/(\s+)/).filter((p) => p.length > 0);
  for (const part of parts) {
    throwIfAborted(signal);
    onToken(part);
    if (delayMs > 0) {
      await delay(delayMs, signal);
    }
  }
}
