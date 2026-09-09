/**
 * One-line dev integration: configure assistant, optional monitoring, FAB overlay.
 */

import { useEffect } from 'react';
import {
  configureDevAIAssistant,
  startNetworkLogMonitoring,
} from './devAssistant';
import { DevAIAssistantOverlay } from './DevAIAssistantOverlay';
import { isDev } from './isDev';
import type { DevAIAssistantConfig } from './types';
import type { NetworkLogMonitoringOptions } from './types';

export interface DevAIAssistantProps extends DevAIAssistantConfig {
  /** Start background network log analysis (default true) */
  autoStartMonitoring?: boolean;
  monitoringOptions?: NetworkLogMonitoringOptions;
  fabBottom?: number;
}

export function DevAIAssistant({
  autoStartMonitoring = true,
  monitoringOptions,
  fabBottom,
  ...config
}: DevAIAssistantProps) {
  useEffect(() => {
    configureDevAIAssistant(config);
    if (autoStartMonitoring) {
      return startNetworkLogMonitoring(monitoringOptions);
    }
    return undefined;
  }, [
    config.appName,
    config.gatewayHost,
    config.gatewayPort,
    config.model,
    config.provider,
    autoStartMonitoring,
  ]);

  if (!isDev()) {
    return null;
  }

  return (
    <DevAIAssistantOverlay
      quickPrompts={config.quickPrompts}
      fabBottom={fabBottom}
    />
  );
}
