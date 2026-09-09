/**
 * Dev AI assistant: providers, network diagnostic tools, and monitoring.
 */

import { Platform } from 'react-native';
import { isDev } from './isDev';
import { createAIAssistant } from '../core/AIAssistant';
import type { AIAssistant } from '../core/AIAssistant.types';
import { MockAIProvider } from '../providers/MockAIProvider';
import type { MockAIProvider as MockProviderType } from '../providers/MockAIProvider';
import { HttpGatewayProvider } from '../providers/HttpGatewayProvider';
import {
  clearNetworkLogs,
  getNetworkLogStats,
  getRecentNetworkLogs,
  seedSampleNetworkLogs,
  subscribeNetworkLogs,
} from './networkLogStore';
import type {
  DevAIAssistantConfig,
  DevAIProviderMode,
  DevAIAssistantRuntime,
  NetworkLogMonitoringOptions,
} from './types';

const OLLAMA_GATEWAY_PORT_DEFAULT = 8787;

const NETWORK_VERIFY_SCENARIOS = [
  {
    type: 'tool_calls' as const,
    toolCalls: [
      { name: 'getNetworkInfo', arguments: {} },
      { name: 'getRecentNetworkLogs', arguments: { limit: 20 } },
      { name: 'getNetworkLogStats', arguments: {} },
    ],
  },
  {
    type: 'text' as const,
    content:
      'Network diagnostics complete. Reviewed connectivity state and recent API logs. Check tool results for failures (4xx/5xx), slow calls, and connectivity issues.',
  },
];

let config: DevAIAssistantConfig | null = null;
let assistantInstance: AIAssistant | null = null;
let mockProvider: MockProviderType | null = null;
let activeProviderName = 'mock';

function normalizeProvider(mode?: DevAIProviderMode): 'mock' | 'local' | 'cloud' | 'auto' {
  if (mode === 'mock') return 'mock';
  if (mode === 'cloud') return 'cloud';
  if (mode === 'auto') return 'auto';
  // 'local', 'ollama', or unset → local gateway
  return 'local';
}

let monitoringUnsubscribe: (() => void) | null = null;
let analysisTimer: ReturnType<typeof setTimeout> | null = null;
let analysisInFlight = false;
let completedRequestCount = 0;
let lastAnalyzedCompletedCount = 0;

function logDev(tag: string, payload: unknown) {
  if (isDev()) {
    console.log(`${tag} ${JSON.stringify(payload, null, 2)}`);
  }
}

export function configureDevAIAssistant(next: DevAIAssistantConfig): void {
  config = { ...next };
}

function requireConfig(): DevAIAssistantConfig {
  if (!config) {
    throw new Error(
      'Dev AI assistant not configured. Call configureDevAIAssistant() or mount <DevAIAssistant />.'
    );
  }
  return config;
}

export function getPreferredProvider(): DevAIProviderMode {
  const globalOverride =
    typeof global !== 'undefined'
      ? (global as unknown as { __AI_ASSISTANT_PROVIDER__?: DevAIProviderMode })
          .__AI_ASSISTANT_PROVIDER__
      : undefined;
  if (globalOverride) {
    return globalOverride;
  }
  const cfg = config;
  if (cfg?.provider) {
    return cfg.provider;
  }
  return 'local';
}

export function getActiveProviderName(): string {
  return activeProviderName;
}

function getOllamaGatewayCandidates() {
  const cfg = requireConfig();
  const port = cfg.gatewayPort ?? OLLAMA_GATEWAY_PORT_DEFAULT;

  if (cfg.gatewayHost) {
    return [`http://${cfg.gatewayHost}:${port}`];
  }

  if (Platform.OS === 'android') {
    return [
      `http://10.0.2.2:${port}`,
      `http://127.0.0.1:${port}`,
    ];
  }

  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

async function fetchNetworkInfo() {
  const cfg = requireConfig();
  let netState: {
    isConnected?: boolean | null;
    isInternetReachable?: boolean | null;
    type?: string;
    details?: {
      isConnectionExpensive?: boolean | null;
      cellularGeneration?: string | null;
    };
  } = {};

  try {
    const NetInfo = require('@react-native-community/netinfo').default;
    netState = await NetInfo.fetch();
  } catch {
    // NetInfo optional — still return minimal payload
  }

  const extras = cfg.getNetworkExtras
    ? await Promise.resolve(cfg.getNetworkExtras())
    : {};

  return {
    connected: Boolean(netState.isConnected),
    isInternetReachable: netState.isInternetReachable ?? null,
    networkType: netState.type ?? null,
    details: {
      isConnectionExpensive: netState.details?.isConnectionExpensive ?? null,
      cellularGeneration: netState.details?.cellularGeneration ?? null,
    },
    platform: Platform.OS,
    appName: cfg.appName,
    source: 'react-native-ai-assistant-dev',
    ...extras,
  };
}

function registerSharedTools(assistant: AIAssistant) {
  const cfg = requireConfig();

  assistant.registerContextProvider({
    name: 'application',
    priority: 10,
    getContext: () => ({
      appName: cfg.appName,
      platform: Platform.OS,
      feature: 'app-diagnostics',
      providerMode: activeProviderName,
    }),
  });

  assistant.registerTool({
    name: 'getNetworkInfo',
    description:
      'Returns current device network connectivity status via NetInfo',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => fetchNetworkInfo(),
  });

  assistant.registerTool({
    name: 'getRecentNetworkLogs',
    description:
      'Returns recent app HTTP API calls (url/path, method, status, durationMs). ' +
      'Use this to name specific APIs. Also returns slowest[] sorted by durationMs desc. ' +
      'These URLs are the API names — not the tool name getRecentNetworkLogs.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
    execute: async (input: Record<string, unknown> = {}) => {
      const rawLimit = input.limit ?? (input.parameters as { limit?: unknown })?.limit;
      const parsed =
        typeof rawLimit === 'number'
          ? rawLimit
          : typeof rawLimit === 'string'
            ? Number(rawLimit)
            : 20;
      const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
      const logs = getRecentNetworkLogs(limit);
      const slowest = [...logs]
        .filter(entry => typeof entry.durationMs === 'number')
        .sort((a, b) => (b.durationMs || 0) - (a.durationMs || 0))
        .slice(0, 5)
        .map(entry => ({
          api: entry.url,
          method: entry.method,
          status: entry.status,
          durationMs: entry.durationMs,
        }));
      return { logs, slowest, count: logs.length };
    },
  });

  assistant.registerTool({
    name: 'getNetworkLogStats',
    description:
      'Returns aggregate network stats only (counts, avgDurationMs). Does NOT include individual API URL names. For API names use getRecentNetworkLogs.',
    inputSchema: { type: 'object', properties: {} },
    execute: async () => getNetworkLogStats(),
  });

  for (const tool of cfg.tools ?? []) {
    assistant.registerTool(tool);
  }
}

async function probeGateway(baseUrl: string) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) {
      return { ok: false as const, reason: `HTTP ${response.status}`, baseUrl };
    }
    const body = (await response.json()) as { ok?: boolean };
    return { ok: Boolean(body?.ok), body, baseUrl };
  } catch (error) {
    return {
      ok: false as const,
      reason: error instanceof Error ? error.message : 'Gateway unreachable',
      baseUrl,
    };
  }
}

async function findReachableLocalGateway() {
  const candidates = getOllamaGatewayCandidates();
  const failures: Array<{ baseUrl: string; reason: string }> = [];
  for (const baseUrl of candidates) {
    const health = await probeGateway(baseUrl);
    if (health.ok) {
      return health;
    }
    failures.push({ baseUrl, reason: health.reason ?? 'unreachable' });
  }
  return {
    ok: false as const,
    reason: failures.map(f => `${f.baseUrl}: ${f.reason}`).join(' | '),
    failures,
    expectedGateway: candidates[0],
  };
}

function getCloudGatewayUrl(): string | null {
  const url = requireConfig().cloudGatewayUrl?.trim();
  return url || null;
}

async function findReachableCloudGateway() {
  const baseUrl = getCloudGatewayUrl();
  if (!baseUrl) {
    return {
      ok: false as const,
      reason: 'cloudGatewayUrl not configured',
      expectedGateway: null,
    };
  }
  const health = await probeGateway(baseUrl.replace(/\/$/, ''));
  if (health.ok) {
    return health;
  }
  return {
    ok: false as const,
    reason: health.reason ?? 'Cloud gateway unreachable',
    expectedGateway: baseUrl,
  };
}

function createMockAssistant() {
  mockProvider = new MockAIProvider({
    scenarios: NETWORK_VERIFY_SCENARIOS,
    loop: true,
  });
  activeProviderName = 'mock';
  const assistant = createAIAssistant({
    provider: mockProvider,
    environment: 'development',
    session: { maxHistoryMessages: 50, maxToolRounds: 5 },
    security: {
      blockedFields: [
        'password',
        'accessToken',
        'refreshToken',
        'authorization',
        'ssid',
      ],
    },
  });
  registerSharedTools(assistant);
  return assistant;
}

function createGatewayAssistant(baseUrl: string, mode: 'local' | 'cloud') {
  const cfg = requireConfig();
  mockProvider = null;
  activeProviderName = mode;
  const provider = new HttpGatewayProvider({
    baseUrl,
    name: mode === 'cloud' ? 'cloud-gateway' : 'local-gateway',
    model: cfg.model ?? 'llama3.2:1b',
    headers: mode === 'cloud' ? cfg.getAuthHeaders : undefined,
  });

  const assistant = createAIAssistant({
    provider,
    environment: 'development',
    timeoutMs: 90_000,
    retry: { maxRetries: 1, backoff: 'exponential' },
    session: { maxHistoryMessages: 50, maxToolRounds: 5 },
    security: {
      blockedFields: [
        'password',
        'accessToken',
        'refreshToken',
        'authorization',
        'ssid',
      ],
    },
  });
  registerSharedTools(assistant);
  return assistant;
}

export function getDevAIAssistant(): AIAssistant {
  if (assistantInstance) {
    return assistantInstance;
  }

  const mode = normalizeProvider(getPreferredProvider());

  if (mode === 'cloud') {
    const cloudUrl = getCloudGatewayUrl();
    if (cloudUrl) {
      assistantInstance = createGatewayAssistant(cloudUrl.replace(/\/$/, ''), 'cloud');
      logDev('[AIAssistant][Provider]', { mode: 'cloud', baseUrl: cloudUrl });
      return assistantInstance;
    }
  }

  if (mode === 'local' || mode === 'auto') {
    const baseUrl = getOllamaGatewayCandidates()[0];
    assistantInstance = createGatewayAssistant(baseUrl, 'local');
    logDev('[AIAssistant][Provider]', { mode: 'local', baseUrl });
    return assistantInstance;
  }

  assistantInstance = createMockAssistant();
  logDev('[AIAssistant][Provider]', { mode: 'mock' });
  return assistantInstance;
}

async function resolveGatewayProvider(): Promise<AIAssistant> {
  const mode = normalizeProvider(getPreferredProvider());

  if (mode === 'mock') {
    return getDevAIAssistant();
  }

  if (mode === 'cloud') {
    const health = await findReachableCloudGateway();
    if (health.ok) {
      if (assistantInstance) {
        assistantInstance.dispose();
        assistantInstance = null;
      }
      assistantInstance = createGatewayAssistant(health.baseUrl, 'cloud');
      logDev('[AIAssistant][Provider]', { mode: 'cloud', baseUrl: health.baseUrl });
      return assistantInstance;
    }
    logDev('[AIAssistant][Provider]', {
      mode: 'mock-fallback',
      reason: health.reason,
      hint: 'Set cloudGatewayUrl and run your cloud/MCP gateway with GET /health.',
    });
    assistantInstance = createMockAssistant();
    return assistantInstance;
  }

  if (mode === 'local') {
    const health = await findReachableLocalGateway();
    if (health.ok) {
      if (!assistantInstance || activeProviderName !== 'local') {
        if (assistantInstance) {
          assistantInstance.dispose();
          assistantInstance = null;
        }
        assistantInstance = createGatewayAssistant(health.baseUrl, 'local');
      }
      logDev('[AIAssistant][Provider]', {
        mode: 'local',
        baseUrl: health.baseUrl,
        health: health.body,
      });
      return assistantInstance;
    }
    const failure = health as {
      ok: false;
      reason: string;
      expectedGateway: string;
    };
    logDev('[AIAssistant][Provider]', {
      mode: 'mock-fallback',
      reason: failure.reason,
      expectedGateway: failure.expectedGateway,
      hint:
        'Run: cd examples/ollama-gateway && npm start. On a physical device set gatewayHost to your Mac LAN IP.',
    });
    assistantInstance = createMockAssistant();
    return assistantInstance;
  }

  // auto: local first, then cloud, then mock
  const localHealth = await findReachableLocalGateway();
  if (localHealth.ok) {
    if (assistantInstance) {
      assistantInstance.dispose();
      assistantInstance = null;
    }
    assistantInstance = createGatewayAssistant(localHealth.baseUrl, 'local');
    logDev('[AIAssistant][Provider]', { mode: 'auto→local', baseUrl: localHealth.baseUrl });
    return assistantInstance;
  }

  const cloudHealth = await findReachableCloudGateway();
  if (cloudHealth.ok) {
    if (assistantInstance) {
      assistantInstance.dispose();
      assistantInstance = null;
    }
    assistantInstance = createGatewayAssistant(cloudHealth.baseUrl, 'cloud');
    logDev('[AIAssistant][Provider]', { mode: 'auto→cloud', baseUrl: cloudHealth.baseUrl });
    return assistantInstance;
  }

  logDev('[AIAssistant][Provider]', {
    mode: 'auto→mock-fallback',
    localReason: localHealth.reason,
    cloudReason: cloudHealth.reason,
  });
  assistantInstance = createMockAssistant();
  return assistantInstance;
}

export async function ensureDevAIAssistantProvider(): Promise<AIAssistant> {
  const mode = normalizeProvider(getPreferredProvider());
  if (mode === 'mock') {
    return getDevAIAssistant();
  }
  return resolveGatewayProvider();
}

export async function verifyNetworkLogsWithAI(options: {
  seedIfEmpty?: boolean;
  label?: string;
} = {}) {
  const { seedIfEmpty = true, label = 'manual' } = options;
  const assistant = await ensureDevAIAssistantProvider();

  mockProvider?.reset();

  if (seedIfEmpty && getRecentNetworkLogs(1).length === 0) {
    seedSampleNetworkLogs();
  }

  const session = assistant.createSession({
    id: `network-verify-${Date.now()}`,
  });
  const toolResults: Array<{
    name: string;
    isError: boolean;
    content: unknown;
  }> = [];
  const tokens: string[] = [];

  const response = await session
    .streamMessage(
      'Analyze recent network logs and connectivity. Summarize failures and latency. Use tools.',
      {
        onToken: token => tokens.push(token),
        onToolResult: result => {
          toolResults.push({
            name: result.name,
            isError: result.isError,
            content: result.content,
          });
        },
      }
    )
    .promise;

  const logsTool = toolResults.find(item => item.name === 'getRecentNetworkLogs');
  const infoTool = toolResults.find(item => item.name === 'getNetworkInfo');
  const statsTool = toolResults.find(item => item.name === 'getNetworkLogStats');

  const logs =
    (logsTool?.content as { logs?: ReturnType<typeof getRecentNetworkLogs> })
      ?.logs ?? getRecentNetworkLogs(20);
  const errorLogs = logs.filter(
    entry =>
      entry.phase === 'error' ||
      (typeof entry.status === 'number' && entry.status >= 400)
  );

  const result = {
    ok: Boolean(response?.message?.content),
    provider: activeProviderName,
    label,
    at: new Date().toISOString(),
    content: response.message.content,
    streamedPreview: tokens.join('').slice(0, 400),
    historyRoles: session.getHistory().map(message => message.role),
    toolNames: toolResults.map(item => item.name),
    networkInfo: infoTool?.content ?? null,
    stats: statsTool?.content ?? getNetworkLogStats(),
    recentLogs: logs,
    errorLogs,
    summary: {
      logCount: logs.length,
      errorCount: errorLogs.length,
      connected:
        (infoTool?.content as { connected?: boolean })?.connected ?? null,
      networkType:
        (infoTool?.content as { networkType?: string })?.networkType ?? null,
      avgDurationMs:
        (statsTool?.content as { avgDurationMs?: number })?.avgDurationMs ??
        getNetworkLogStats().avgDurationMs ??
        null,
    },
  };

  logDev('[AIAssistant][NetworkLogs]', result);
  return result;
}

export function startNetworkLogMonitoring(
  options: NetworkLogMonitoringOptions = {}
) {
  const analysisDebounceMs = options.analysisDebounceMs ?? 2500;
  const minCompletedForAnalysis = options.minCompletedForAnalysis ?? 3;

  stopNetworkLogMonitoring();

  logDev('[AIAssistant][NetworkLogs][Monitor]', {
    status: 'started',
    providerPreference: getPreferredProvider(),
    analysisDebounceMs,
    minCompletedForAnalysis,
  });

  ensureDevAIAssistantProvider()
    .then(() =>
      verifyNetworkLogsWithAI({ seedIfEmpty: true, label: 'startup' })
    )
    .catch(error => {
      console.warn('[AIAssistant][NetworkLogs] startup failed', error);
    });

  monitoringUnsubscribe = subscribeNetworkLogs((entry, reason) => {
    if (reason === 'complete' && entry.phase !== 'pending') {
      completedRequestCount += 1;
      logDev('[AIAssistant][NetworkRequest]', {
        method: entry.method,
        url: entry.url,
        status: entry.status,
        durationMs: entry.durationMs,
        phase: entry.phase,
        completedRequestCount,
      });

      if (analysisTimer) {
        clearTimeout(analysisTimer);
      }

      analysisTimer = setTimeout(() => {
        const shouldAnalyze =
          !analysisInFlight &&
          completedRequestCount >= minCompletedForAnalysis &&
          completedRequestCount !== lastAnalyzedCompletedCount;

        if (!shouldAnalyze) {
          return;
        }

        analysisInFlight = true;
        lastAnalyzedCompletedCount = completedRequestCount;
        verifyNetworkLogsWithAI({
          seedIfEmpty: false,
          label: `live-after-${completedRequestCount}-requests`,
        })
          .catch(error => {
            console.warn('[AIAssistant][NetworkLogs] live analysis failed', error);
          })
          .finally(() => {
            analysisInFlight = false;
          });
      }, analysisDebounceMs);
    }
  });

  return stopNetworkLogMonitoring;
}

export function stopNetworkLogMonitoring() {
  if (monitoringUnsubscribe) {
    monitoringUnsubscribe();
    monitoringUnsubscribe = null;
  }
  if (analysisTimer) {
    clearTimeout(analysisTimer);
    analysisTimer = null;
  }
}

export function resetDevAIAssistant() {
  stopNetworkLogMonitoring();
  if (assistantInstance) {
    assistantInstance.dispose();
    assistantInstance = null;
  }
  mockProvider = null;
  activeProviderName = 'mock';
  completedRequestCount = 0;
  lastAnalyzedCompletedCount = 0;
  clearNetworkLogs();
}

export function createDevAIAssistantRuntime(): DevAIAssistantRuntime {
  return {
    getAssistant: getDevAIAssistant,
    ensureProvider: ensureDevAIAssistantProvider,
    getActiveProviderName,
    getPreferredProvider,
    startMonitoring: startNetworkLogMonitoring,
    stopMonitoring: stopNetworkLogMonitoring,
    reset: resetDevAIAssistant,
    verifyNetworkLogs: verifyNetworkLogsWithAI,
  };
}
