/**
 * In-memory ring buffer for recent HTTP activity.
 * Used by dev AI tools — never stores tokens or bodies.
 */

export type NetworkLogPhase = 'pending' | 'success' | 'error';

export interface NetworkLogEntry {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  status: number | null;
  durationMs: number | null;
  phase: NetworkLogPhase;
  errorMessage?: string;
}

type NetworkLogListener = (
  entry: NetworkLogEntry,
  reason: 'push' | 'complete'
) => void;

const DEFAULT_MAX_ENTRIES = 100;

let entries: NetworkLogEntry[] = [];
let maxEntries = DEFAULT_MAX_ENTRIES;
const listeners = new Set<NetworkLogListener>();

function notifyListeners(entry: NetworkLogEntry, reason: 'push' | 'complete') {
  listeners.forEach(listener => {
    try {
      listener(entry, reason);
    } catch {
      // listeners must not break request path
    }
  });
}

export function subscribeNetworkLogs(listener: NetworkLogListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'apikey',
  'api_key',
  'password',
  'secret',
]);

function createId(): string {
  return `net_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sanitizeNetworkUrl(rawUrl = ''): string {
  try {
    const hasProtocol = /^https?:\/\//i.test(rawUrl);
    const url = hasProtocol
      ? new URL(rawUrl)
      : new URL(rawUrl, 'https://local.invalid');

    url.searchParams.forEach((_value, key) => {
      if (
        SENSITIVE_QUERY_KEYS.has(key.replace(/[^a-z0-9_]/gi, '').toLowerCase())
      ) {
        url.searchParams.set(key, '[REDACTED]');
      }
    });

    if (hasProtocol) {
      return url.toString();
    }

    return `${url.pathname}${url.search}`;
  } catch {
    return String(rawUrl).slice(0, 300);
  }
}

function trimBuffer() {
  if (entries.length > maxEntries) {
    entries = entries.slice(entries.length - maxEntries);
  }
}

export function pushNetworkLog(
  partial: Partial<NetworkLogEntry> & { method?: string; url?: string }
): NetworkLogEntry {
  const entry: NetworkLogEntry = {
    id: partial.id || createId(),
    timestamp: partial.timestamp || Date.now(),
    method: (partial.method || 'GET').toUpperCase(),
    url: sanitizeNetworkUrl(partial.url || ''),
    status: partial.status ?? null,
    durationMs: partial.durationMs ?? null,
    phase: partial.phase || 'pending',
    errorMessage: partial.errorMessage
      ? String(partial.errorMessage).slice(0, 200)
      : undefined,
  };

  entries.push(entry);
  trimBuffer();
  notifyListeners(entry, 'push');
  return entry;
}

export function markNetworkRequestStart(config: {
  method?: string;
  url?: string;
} = {}): string {
  const id = createId();
  pushNetworkLog({
    id,
    method: config.method,
    url: config.url,
    phase: 'pending',
    status: null,
    durationMs: null,
  });
  return id;
}

export function completeNetworkLog(
  id: string | undefined,
  update: {
    status?: number | null;
    durationMs?: number | null;
    errorMessage?: string;
    method?: string;
    url?: string;
    phase?: 'success' | 'error';
  } = {}
): NetworkLogEntry {
  const index = id ? entries.findIndex(entry => entry.id === id) : -1;
  if (index >= 0) {
    entries[index] = {
      ...entries[index],
      status: update.status ?? entries[index].status,
      durationMs: update.durationMs ?? entries[index].durationMs,
      phase: update.phase || (update.errorMessage ? 'error' : 'success'),
      errorMessage: update.errorMessage
        ? String(update.errorMessage).slice(0, 200)
        : entries[index].errorMessage,
    };
    notifyListeners(entries[index], 'complete');
    return entries[index];
  }

  return pushNetworkLog({
    method: update.method,
    url: update.url,
    status: update.status ?? null,
    durationMs: update.durationMs ?? null,
    phase: update.phase || (update.errorMessage ? 'error' : 'success'),
    errorMessage: update.errorMessage,
  });
}

export function getRecentNetworkLogs(limit = 20): NetworkLogEntry[] {
  const size = Math.max(1, Math.min(limit, maxEntries));
  return entries.slice(-size).map(entry => ({ ...entry }));
}

export function getNetworkLogStats() {
  const recent = entries.slice(-50);
  const errors = recent.filter(
    entry => entry.phase === 'error' || (entry.status && entry.status >= 400)
  );
  const success = recent.filter(
    entry => entry.phase === 'success' && entry.status && entry.status < 400
  );
  const pending = recent.filter(entry => entry.phase === 'pending');
  const durations = recent
    .map(entry => entry.durationMs)
    .filter((value): value is number => typeof value === 'number' && value >= 0);
  const avgDurationMs =
    durations.length > 0
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : null;

  return {
    totalCaptured: entries.length,
    recentCount: recent.length,
    successCount: success.length,
    errorCount: errors.length,
    pendingCount: pending.length,
    avgDurationMs,
  };
}

export function clearNetworkLogs() {
  entries = [];
}

export function setNetworkLogMaxEntries(value?: number) {
  maxEntries = Math.max(10, value || DEFAULT_MAX_ENTRIES);
  trimBuffer();
}

export function seedSampleNetworkLogs() {
  const now = Date.now();
  pushNetworkLog({
    id: createId(),
    timestamp: now - 4000,
    method: 'GET',
    url: '/pub/v4/menu/list/platformId/123',
    status: 200,
    durationMs: 180,
    phase: 'success',
  });
  pushNetworkLog({
    id: createId(),
    timestamp: now - 2500,
    method: 'GET',
    url: '/pub/v1/rail-hierarchy/home?token=secret-value',
    status: 200,
    durationMs: 240,
    phase: 'success',
  });
  pushNetworkLog({
    id: createId(),
    timestamp: now - 800,
    method: 'POST',
    url: '/v1/subscriber/profile',
    status: 503,
    durationMs: 1200,
    phase: 'error',
    errorMessage: 'Service Unavailable',
  });
}
