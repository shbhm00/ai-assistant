export interface ContextProviderDefinition {
  name: string;
  /** Higher priority providers are merged first. Default: 0 */
  priority?: number;
  enabled?: boolean;
  /** Soft size budget for this provider's serialized context. */
  maxBytes?: number;
  getContext: () =>
    | Record<string, unknown>
    | Promise<Record<string, unknown>>;
}

export interface CollectedContext {
  /** Merged context keyed by provider name. */
  byProvider: Record<string, Record<string, unknown>>;
  /** Flat merge (later/lower priority overwritten by earlier/higher). */
  merged: Record<string, unknown>;
  truncatedProviders: string[];
  errors: Array<{ provider: string; message: string }>;
}
