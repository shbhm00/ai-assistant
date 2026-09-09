import { ConfigurationError } from '../errors/errors';
import type { ToolDefinition, RegisteredTool } from './types';

/**
 * Generic tool registry. Applications register tools at runtime;
 * the SDK core never ships domain-specific tools.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(definition: ToolDefinition): void {
    if (!definition.name?.trim()) {
      throw new ConfigurationError('Tool name is required');
    }
    if (!definition.description?.trim()) {
      throw new ConfigurationError(`Tool "${definition.name}" requires a description`);
    }
    if (typeof definition.execute !== 'function') {
      throw new ConfigurationError(`Tool "${definition.name}" requires an execute function`);
    }
    if (this.tools.has(definition.name)) {
      throw new ConfigurationError(`Tool "${definition.name}" is already registered`);
    }

    this.tools.set(definition.name, {
      definition,
      registeredAt: Date.now(),
    });
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /** Provider-facing tool descriptors (no execute functions). */
  toProviderTools(): Array<{
    name: string;
    description: string;
    inputSchema?: ToolDefinition['inputSchema'];
  }> {
    return this.list().map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  clear(): void {
    this.tools.clear();
  }

  get size(): number {
    return this.tools.size;
  }
}
