export { DevAIAssistant } from './DevAIAssistant';
export type { DevAIAssistantProps } from './DevAIAssistant';
export { DevAIAssistantOverlay } from './DevAIAssistantOverlay';
export type { DevAIAssistantOverlayProps } from './DevAIAssistantOverlay';

export {
  configureDevAIAssistant,
  getDevAIAssistant,
  ensureDevAIAssistantProvider,
  getActiveProviderName,
  getPreferredProvider,
  startNetworkLogMonitoring,
  stopNetworkLogMonitoring,
  resetDevAIAssistant,
  verifyNetworkLogsWithAI,
  createDevAIAssistantRuntime,
} from './devAssistant';

export { attachAxiosNetworkLogger } from './axiosNetworkLogger';

export {
  subscribeNetworkLogs,
  sanitizeNetworkUrl,
  pushNetworkLog,
  markNetworkRequestStart,
  completeNetworkLog,
  getRecentNetworkLogs,
  getNetworkLogStats,
  clearNetworkLogs,
  setNetworkLogMaxEntries,
  seedSampleNetworkLogs,
} from './networkLogStore';

export type {
  DevAIAssistantConfig,
  DevAIProviderMode,
  DevAIAssistantRuntime,
  NetworkLogMonitoringOptions,
} from './types';

export type { NetworkLogEntry, NetworkLogPhase } from './networkLogStore';

export {
  createDiagnosticLogStore,
  registerDiagnosticLogTools,
} from './diagnosticLogStore';
export type {
  DiagnosticLogEntry,
  DiagnosticLogStore,
  CreateDiagnosticLogStoreOptions,
} from './diagnosticLogStore';
