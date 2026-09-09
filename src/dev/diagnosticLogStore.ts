/**
 * Generic in-memory ring buffer for sanitized diagnostic logs
 * (player events, analytics, custom telemetry).
 */

export interface DiagnosticLogEntry {
  id: string;
  timestamp: number;
  category: string;
  event: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  data?: Record<string, unknown>;
  message?: string;
}

export interface DiagnosticLogStore {
  push: (entry: Omit<DiagnosticLogEntry, 'id' | 'timestamp'> & Partial<Pick<DiagnosticLogEntry, 'id' | 'timestamp'>>) => DiagnosticLogEntry;
  getRecent: (limit?: number) => DiagnosticLogEntry[];
  getStats: () => {
    total: number;
    byLevel: Record<string, number>;
    byCategory: Record<string, number>;
    recentErrors: number;
  };
  clear: () => void;
  subscribe: (
    listener: (entry: DiagnosticLogEntry, reason: 'push') => void
  ) => () => void;
}

export interface CreateDiagnosticLogStoreOptions {
  maxEntries?: number;
  defaultCategory?: string;
}

export function createDiagnosticLogStore(
  options: CreateDiagnosticLogStoreOptions = {}
): DiagnosticLogStore {
  const maxEntries = Math.max(10, options.maxEntries ?? 200);
  const defaultCategory = options.defaultCategory ?? 'general';
  let entries: DiagnosticLogEntry[] = [];
  const listeners = new Set<
    (entry: DiagnosticLogEntry, reason: 'push') => void
  >();

  function createId() {
    return `diag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function trim() {
    if (entries.length > maxEntries) {
      entries = entries.slice(entries.length - maxEntries);
    }
  }

  return {
    push(partial) {
      const entry: DiagnosticLogEntry = {
        id: partial.id ?? createId(),
        timestamp: partial.timestamp ?? Date.now(),
        category: partial.category ?? defaultCategory,
        event: partial.event,
        level: partial.level ?? 'info',
        data: partial.data,
        message: partial.message,
      };
      entries.push(entry);
      trim();
      listeners.forEach(listener => {
        try {
          listener(entry, 'push');
        } catch {
          // ignore listener errors
        }
      });
      return entry;
    },
    getRecent(limit = 20) {
      const size = Math.max(1, Math.min(limit, maxEntries));
      return entries.slice(-size).map(entry => ({ ...entry }));
    },
    getStats() {
      const byLevel: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      let recentErrors = 0;
      for (const entry of entries) {
        const level = entry.level ?? 'info';
        byLevel[level] = (byLevel[level] ?? 0) + 1;
        byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
        if (level === 'error') {
          recentErrors += 1;
        }
      }
      return {
        total: entries.length,
        byLevel,
        byCategory,
        recentErrors,
      };
    },
    clear() {
      entries = [];
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Registers standard getRecent* / get*Stats tools for a diagnostic log store.
 */
export function registerDiagnosticLogTools(
  assistant: { registerTool: (tool: import('../tools/types').ToolDefinition) => void },
  store: DiagnosticLogStore,
  options: { prefix: string; description: string }
) {
  const recentName = `getRecent${options.prefix}Logs`;
  const statsName = `get${options.prefix}LogStats`;

  assistant.registerTool({
    name: recentName,
    description:
      `${options.description} Returns recent entries with event, level, and data. ` +
      'Use this to answer questions about specific player/diagnostic events.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
    execute: async (input: Record<string, unknown> = {}) => {
      const rawLimit = input.limit;
      const parsed =
        typeof rawLimit === 'number'
          ? rawLimit
          : typeof rawLimit === 'string'
            ? Number(rawLimit)
            : 20;
      const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
      const logs = store.getRecent(limit);
      const errors = logs.filter(entry => entry.level === 'error');
      return { logs, errorCount: errors.length, count: logs.length };
    },
  });

  assistant.registerTool({
    name: statsName,
    description: `${options.description} Returns aggregate counts only (no individual events).`,
    inputSchema: { type: 'object', properties: {} },
    execute: async () => store.getStats(),
  });
}
