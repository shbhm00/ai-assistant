import type { ToolDefinition } from '../tools/types';
import type { AIAssistant } from '../core/AIAssistant.types';

/** @deprecated use 'local' */
export type DevAIProviderMode = 'mock' | 'local' | 'cloud' | 'auto' | 'ollama';

export interface DevAIAssistantConfig {
  /** App identifier sent as context to the model */
  appName: string;
  /**
   * - mock: offline scripted responses
   * - local (or ollama): Mac/LAN Ollama gateway (default in __DEV__)
   * - cloud: remote gateway (MCP/LLM behind your BFF)
   * - auto: try local first, then cloud
   */
  provider?: DevAIProviderMode;
  /** Mac LAN IP for physical devices when using local provider */
  gatewayHost?: string;
  gatewayPort?: number;
  model?: string;
  /**
   * Cloud gateway base URL (e.g. https://ai-gateway.yourcompany.com).
   * MCP + API keys live on this server — never in the app.
   */
  cloudGatewayUrl?: string;
  /** Short-lived app session token for cloud gateway (not MCP/LLM keys). */
  getAuthHeaders?: () =>
    | Record<string, string>
    | Promise<Record<string, string>>;
  /** Extra fields merged into getNetworkInfo tool output */
  getNetworkExtras?: () =>
    | Promise<Record<string, unknown>>
    | Record<string, unknown>;
  /** App-specific diagnostic tools (player logs, analytics, etc.) */
  tools?: ToolDefinition[];
  /** Quick prompts shown in the debug overlay */
  quickPrompts?: string[];
}

export interface NetworkLogMonitoringOptions {
  analysisDebounceMs?: number;
  minCompletedForAnalysis?: number;
}

export interface DevAIAssistantRuntime {
  getAssistant: () => AIAssistant;
  ensureProvider: () => Promise<AIAssistant>;
  getActiveProviderName: () => string;
  getPreferredProvider: () => DevAIProviderMode;
  startMonitoring: (options?: NetworkLogMonitoringOptions) => () => void;
  stopMonitoring: () => void;
  reset: () => void;
  verifyNetworkLogs: (options?: {
    seedIfEmpty?: boolean;
    label?: string;
  }) => Promise<Record<string, unknown>>;
}
