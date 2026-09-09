import { ConfigurationError, ContextProviderError } from '../errors/errors';
import { byteLengthOf } from '../utils/id';
import type {
  CollectedContext,
  ContextProviderDefinition,
} from './types';

export interface ContextRegistryOptions {
  maxTotalBytes?: number;
}

/**
 * Generic context provider registry. Domain contexts (navigation, network,
 * debug, etc.) are registered by the consuming application.
 */
export class ContextRegistry {
  private readonly providers = new Map<string, ContextProviderDefinition>();
  private readonly maxTotalBytes: number;

  constructor(options: ContextRegistryOptions = {}) {
    this.maxTotalBytes = options.maxTotalBytes ?? 32_768;
  }

  register(provider: ContextProviderDefinition): void {
    if (!provider.name?.trim()) {
      throw new ConfigurationError('Context provider name is required');
    }
    if (typeof provider.getContext !== 'function') {
      throw new ConfigurationError(
        `Context provider "${provider.name}" requires getContext`
      );
    }
    if (this.providers.has(provider.name)) {
      throw new ConfigurationError(
        `Context provider "${provider.name}" is already registered`
      );
    }
    this.providers.set(provider.name, {
      priority: 0,
      enabled: true,
      ...provider,
    });
  }

  unregister(name: string): boolean {
    return this.providers.delete(name);
  }

  setEnabled(name: string, enabled: boolean): void {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new ConfigurationError(`Context provider "${name}" is not registered`);
    }
    this.providers.set(name, { ...provider, enabled });
  }

  get(name: string): ContextProviderDefinition | undefined {
    return this.providers.get(name);
  }

  list(): ContextProviderDefinition[] {
    return Array.from(this.providers.values()).sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0)
    );
  }

  clear(): void {
    this.providers.clear();
  }

  get size(): number {
    return this.providers.size;
  }

  /**
   * Collects context from enabled providers (priority desc),
   * enforcing per-provider and global size budgets.
   */
  async collect(): Promise<CollectedContext> {
    const enabled = this.list().filter((p) => p.enabled !== false);
    const byProvider: Record<string, Record<string, unknown>> = {};
    const merged: Record<string, unknown> = {};
    const truncatedProviders: string[] = [];
    const errors: CollectedContext['errors'] = [];
    let usedBytes = 0;

    for (const provider of enabled) {
      try {
        const raw = await provider.getContext();
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new ContextProviderError(
            `Context provider "${provider.name}" must return a plain object`
          );
        }

        let context = raw as Record<string, unknown>;
        const providerBudget = provider.maxBytes;
        const size = byteLengthOf(context);

        if (providerBudget !== undefined && size > providerBudget) {
          truncatedProviders.push(provider.name);
          context = {
            _truncated: true,
            _reason: `Exceeded provider maxBytes (${providerBudget})`,
          };
        }

        const nextSize = byteLengthOf(context);
        if (usedBytes + nextSize > this.maxTotalBytes) {
          truncatedProviders.push(provider.name);
          byProvider[provider.name] = {
            _truncated: true,
            _reason: `Exceeded global maxTotalBytes (${this.maxTotalBytes})`,
          };
          continue;
        }

        byProvider[provider.name] = context;
        Object.assign(merged, context);
        usedBytes += nextSize;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        errors.push({ provider: provider.name, message });
      }
    }

    return { byProvider, merged, truncatedProviders, errors };
  }
}
