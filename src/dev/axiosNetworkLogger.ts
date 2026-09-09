/**
 * Attaches sanitized request/response logging to an axios instance.
 * Safe to call multiple times — skips if already attached.
 */

import {
  markNetworkRequestStart,
  completeNetworkLog,
} from './networkLogStore';

const ATTACHED = Symbol('aiAssistantNetworkLogger');

interface AxiosLike {
  interceptors: {
    request: { use: (onFulfilled: (config: AxiosRequestConfig) => AxiosRequestConfig | Promise<AxiosRequestConfig>) => number };
    response: {
      use: (
        onFulfilled: (response: AxiosResponse) => AxiosResponse | Promise<AxiosResponse>,
        onRejected: (error: AxiosError) => unknown
      ) => number;
    };
  };
}

interface AxiosRequestConfig {
  method?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

interface AxiosResponse {
  status?: number;
  config?: AxiosRequestConfig;
}

interface AxiosError {
  message?: string;
  config?: AxiosRequestConfig;
  response?: { status?: number; data?: { message?: string } };
}

function captureRequestStart(config: AxiosRequestConfig): AxiosRequestConfig {
  try {
    config.metadata = config.metadata || {};
    config.metadata.aiNetworkStartedAt = Date.now();
    config.metadata.aiNetworkLogId = markNetworkRequestStart({
      method: config.method,
      url: config.url,
    });
  } catch {
    // must never break API flow
  }
  return config;
}

function captureResponseSuccess(response: AxiosResponse): AxiosResponse {
  try {
    const startedAt = response?.config?.metadata?.aiNetworkStartedAt;
    completeNetworkLog(
      response?.config?.metadata?.aiNetworkLogId as string | undefined,
      {
        method: response?.config?.method,
        url: response?.config?.url,
        status: response?.status ?? null,
        durationMs:
          typeof startedAt === 'number' ? Date.now() - startedAt : null,
        phase: 'success',
      }
    );
  } catch {
    // must never break API flow
  }
  return response;
}

function captureResponseError(error: AxiosError) {
  try {
    const config = error?.config;
    const startedAt = config?.metadata?.aiNetworkStartedAt;
    completeNetworkLog(config?.metadata?.aiNetworkLogId as string | undefined, {
      method: config?.method,
      url: config?.url,
      status: error?.response?.status ?? null,
      durationMs:
        typeof startedAt === 'number' ? Date.now() - startedAt : null,
      phase: 'error',
      errorMessage:
        error?.message ||
        error?.response?.data?.message ||
        'Network request failed',
    });
  } catch {
    // must never break API flow
  }
  return Promise.reject(error);
}

export function attachAxiosNetworkLogger(instance: AxiosLike): void {
  const tagged = instance as AxiosLike & { [ATTACHED]?: boolean };
  if (tagged[ATTACHED]) {
    return;
  }
  tagged[ATTACHED] = true;

  instance.interceptors.request.use(config => captureRequestStart(config));
  instance.interceptors.response.use(
    response => captureResponseSuccess(response),
    error => captureResponseError(error)
  );
}
