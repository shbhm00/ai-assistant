/**
 * Pluggable observability. Applications adapt this to Sentry, CleverTap,
 * Firebase, custom pipelines, etc. The SDK never imports those SDKs.
 *
 * By default, sensitive prompt/context payloads are NOT included.
 */

export interface ObserverRequestEvent {
  requestId: string;
  sessionId: string;
  provider: string;
  model?: string;
  streaming: boolean;
  toolCount: number;
  startedAt: number;
}

export interface ObserverRequestCompleteEvent extends ObserverRequestEvent {
  latencyMs: number;
  success: boolean;
  toolRounds?: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface ObserverRequestErrorEvent extends ObserverRequestEvent {
  latencyMs: number;
  code: string;
  message: string;
  retryable: boolean;
}

export interface ObserverToolEvent {
  requestId: string;
  sessionId: string;
  toolName: string;
  toolCallId: string;
  startedAt: number;
}

export interface ObserverToolCompleteEvent extends ObserverToolEvent {
  durationMs: number;
  success: boolean;
  errorCode?: string;
}

export interface ObserverStreamEvent {
  requestId: string;
  sessionId: string;
  provider: string;
  startedAt: number;
}

export interface ObserverStreamCompleteEvent extends ObserverStreamEvent {
  durationMs: number;
  tokenCount?: number;
  cancelled?: boolean;
}

export interface AIAssistantObserver {
  onRequestStart?: (event: ObserverRequestEvent) => void;
  onRequestComplete?: (event: ObserverRequestCompleteEvent) => void;
  onRequestError?: (event: ObserverRequestErrorEvent) => void;
  onToolStart?: (event: ObserverToolEvent) => void;
  onToolComplete?: (event: ObserverToolCompleteEvent) => void;
  onStreamStart?: (event: ObserverStreamEvent) => void;
  onStreamComplete?: (event: ObserverStreamCompleteEvent) => void;
}

export const noopObserver: AIAssistantObserver = {};

export function composeObservers(
  ...observers: Array<AIAssistantObserver | undefined>
): AIAssistantObserver {
  const list = observers.filter(Boolean) as AIAssistantObserver[];
  if (list.length === 0) {
    return noopObserver;
  }
  if (list.length === 1) {
    return list[0]!;
  }

  const invoke = <K extends keyof AIAssistantObserver>(
    key: K,
    event: Parameters<NonNullable<AIAssistantObserver[K]>>[0]
  ) => {
    for (const observer of list) {
      try {
        const fn = observer[key];
        if (fn) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (fn as any)(event);
        }
      } catch {
        // Observers must never break the request path.
      }
    }
  };

  return {
    onRequestStart: (e) => invoke('onRequestStart', e),
    onRequestComplete: (e) => invoke('onRequestComplete', e),
    onRequestError: (e) => invoke('onRequestError', e),
    onToolStart: (e) => invoke('onToolStart', e),
    onToolComplete: (e) => invoke('onToolComplete', e),
    onStreamStart: (e) => invoke('onStreamStart', e),
    onStreamComplete: (e) => invoke('onStreamComplete', e),
  };
}
