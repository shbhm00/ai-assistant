import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import type { AIAssistant } from '../core/AIAssistant.types';
import type { AISession, StreamHandle, StreamMessageCallbacks } from '../session/types';
import type { AIResponse } from '../providers/AIProvider';
import type { Message } from '../core/types';
import type { AIAssistantError } from '../errors/errors';
import { toAIAssistantError } from '../errors/errors';

/**
 * Optional React adapter: holds a stable assistant reference.
 * Core SDK does not depend on React.
 */
export function useAIAssistant(assistant: AIAssistant): AIAssistant {
  return assistant;
}

export interface UseAISessionResult {
  session: AISession;
  history: Message[];
  clear: () => void;
  refresh: () => void;
}

export function useAISession(
  assistant: AIAssistant,
  options?: { id?: string; maxHistoryMessages?: number }
): UseAISessionResult {
  const sessionRef = useRef<AISession | null>(null);
  if (!sessionRef.current) {
    sessionRef.current = assistant.createSession(options);
  }

  const session = sessionRef.current;

  const [history, setHistory] = useState<Message[]>(() => session.getHistory());

  const refresh = useCallback(() => {
    setHistory(session.getHistory());
  }, [session]);

  const clear = useCallback(() => {
    session.clear();
    refresh();
  }, [session, refresh]);

  return {
    session,
    history,
    clear,
    refresh,
  };
}

export interface UseAIStreamingState {
  isStreaming: boolean;
  partialText: string;
  error: AIAssistantError | null;
  lastResponse: AIResponse | null;
}

export interface UseAIStreamingResult extends UseAIStreamingState {
  streamMessage: (
    content: string,
    callbacks?: StreamMessageCallbacks
  ) => StreamHandle;
  sendMessage: (content: string) => Promise<AIResponse>;
  cancel: () => void;
  reset: () => void;
}

/**
 * Streaming helper for React UIs. Cancellation is session/request based,
 * not React-state based.
 */
export function useAIStreaming(session: AISession): UseAIStreamingResult {
  const [state, setState] = useState<UseAIStreamingState>({
    isStreaming: false,
    partialText: '',
    error: null,
    lastResponse: null,
  });
  const handleRef = useRef<StreamHandle | null>(null);

  useEffect(() => {
    return () => {
      handleRef.current?.cancel('Component unmounted');
    };
  }, []);

  const reset = useCallback(() => {
    setState({
      isStreaming: false,
      partialText: '',
      error: null,
      lastResponse: null,
    });
  }, []);

  const cancel = useCallback(() => {
    handleRef.current?.cancel();
  }, []);

  const streamMessage = useCallback(
    (content: string, callbacks: StreamMessageCallbacks = {}) => {
      setState({
        isStreaming: true,
        partialText: '',
        error: null,
        lastResponse: null,
      });

      const handle = session.streamMessage(content, {
        onToken: (token) => {
          setState((prev) => ({
            ...prev,
            partialText: prev.partialText + token,
          }));
          callbacks.onToken?.(token);
        },
        onToolCall: callbacks.onToolCall,
        onToolResult: callbacks.onToolResult,
        onComplete: (response) => {
          setState({
            isStreaming: false,
            partialText: response.message.content,
            error: null,
            lastResponse: response,
          });
          callbacks.onComplete?.(response);
        },
        onError: (error) => {
          setState((prev) => ({
            ...prev,
            isStreaming: false,
            error,
          }));
          callbacks.onError?.(error);
        },
      });

      handleRef.current = handle;
      return handle;
    },
    [session]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      setState((prev) => ({ ...prev, isStreaming: true, error: null }));
      try {
        const response = await session.sendMessage(content);
        setState({
          isStreaming: false,
          partialText: response.message.content,
          error: null,
          lastResponse: response,
        });
        return response;
      } catch (error) {
        const normalized = toAIAssistantError(error);
        setState((prev) => ({
          ...prev,
          isStreaming: false,
          error: normalized,
        }));
        throw normalized;
      }
    },
    [session]
  );

  return useMemo(
    () => ({
      ...state,
      streamMessage,
      sendMessage,
      cancel,
      reset,
    }),
    [state, streamMessage, sendMessage, cancel, reset]
  );
}
