import type { SecurityConfig } from '../core/types';

export const DEFAULT_BLOCKED_FIELDS = [
  'password',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'creditcard',
  'secret',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'ssn',
  'cvv',
] as const;

const REDACTED = '[REDACTED]';

function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export interface SensitiveDataFilterOptions {
  blockedFields?: string[];
  customRedactor?: SecurityConfig['customRedactor'];
  redactedValue?: string;
}

/**
 * Recursively redacts sensitive fields from objects/arrays before
 * provider transmission, logging, or observer telemetry.
 */
export class SensitiveDataFilter {
  private readonly blocked: Set<string>;
  private readonly customRedactor?: SecurityConfig['customRedactor'];
  private readonly redactedValue: string;

  constructor(options: SensitiveDataFilterOptions = {}) {
    const fields = [
      ...DEFAULT_BLOCKED_FIELDS,
      ...(options.blockedFields ?? []).map((f) => normalizeKey(f)),
    ];
    this.blocked = new Set(fields.map(normalizeKey));
    this.customRedactor = options.customRedactor;
    this.redactedValue = options.redactedValue ?? REDACTED;
  }

  isBlockedKey(key: string): boolean {
    return this.blocked.has(normalizeKey(key));
  }

  redact<T>(value: T, path = ''): T {
    return this.walk(value, path) as T;
  }

  private walk(value: unknown, path: string): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item, index) => this.walk(item, `${path}[${index}]`));
    }

    if (typeof value === 'object') {
      const input = value as Record<string, unknown>;
      const output: Record<string, unknown> = {};

      for (const [key, child] of Object.entries(input)) {
        const childPath = path ? `${path}.${key}` : key;

        if (this.isBlockedKey(key)) {
          output[key] = this.redactedValue;
          continue;
        }

        if (this.customRedactor) {
          const custom = this.customRedactor(child, childPath, key);
          if (custom !== undefined) {
            output[key] = custom;
            continue;
          }
        }

        output[key] = this.walk(child, childPath);
      }

      return output;
    }

    return value;
  }
}

export function createSensitiveDataFilter(
  config?: Partial<SecurityConfig>
): SensitiveDataFilter {
  return new SensitiveDataFilter({
    blockedFields: config?.blockedFields,
    customRedactor: config?.customRedactor,
  });
}
