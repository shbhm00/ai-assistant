import {
  ToolExecutionError,
  ToolNotFoundError,
  ToolValidationError,
  TimeoutError,
  toAIAssistantError,
} from '../errors/errors';
import type { JSONSchema } from '../core/types';
import { withTimeout } from '../utils/timeout';
import { throwIfAborted } from '../utils/cancellation';
import type { ToolRegistry } from './ToolRegistry';
import type { ToolCallRequest, ToolCallResult, ToolExecutionContext } from './types';

/**
 * Lightweight JSON Schema subset validator (object/array/primitives).
 * Sufficient for tool input gating without pulling ajv into the RN bundle.
 */
export function coerceValueToSchema(
  value: unknown,
  schema: JSONSchema | undefined
): unknown {
  if (!schema) {
    return value;
  }

  // Small LLMs wrap args as { type:'function', function:'name', parameters:{...} }
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'parameters' in (value as Record<string, unknown>) &&
    typeof (value as Record<string, unknown>).parameters === 'object'
  ) {
    const wrapper = value as Record<string, unknown>;
    if (wrapper.type === 'function' || typeof wrapper.function === 'string') {
      value = wrapper.parameters;
    }
  }

  const types = schema.type
    ? Array.isArray(schema.type)
      ? schema.type
      : [schema.type]
    : undefined;

  if (types?.includes('object') && value && typeof value === 'object' && !Array.isArray(value)) {
    const input = value as Record<string, unknown>;
    if (!schema.properties) {
      return value;
    }
    const output: Record<string, unknown> = { ...input };
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in output) {
        output[key] = coerceValueToSchema(output[key], propSchema);
      }
    }
    return output;
  }

  if (types?.includes('array') && Array.isArray(value) && schema.items && !Array.isArray(schema.items)) {
    return value.map((item) => coerceValueToSchema(item, schema.items as JSONSchema));
  }

  // Small LLMs often pass numbers/booleans as strings.
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (types?.includes('number') || types?.includes('integer')) {
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        const num = Number(trimmed);
        if (types.includes('integer')) {
          return Math.trunc(num);
        }
        return num;
      }
    }
    if (types?.includes('boolean')) {
      if (trimmed === 'true') return true;
      if (trimmed === 'false') return false;
    }
  }

  return value;
}

export function validateAgainstSchema(
  value: unknown,
  schema: JSONSchema | undefined,
  path = 'input'
): void {
  if (!schema) {
    return;
  }

  const types = schema.type
    ? Array.isArray(schema.type)
      ? schema.type
      : [schema.type]
    : undefined;

  if (types && types.length > 0) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const normalized =
      actual === 'number' && types.includes('integer') && Number.isInteger(value)
        ? 'integer'
        : actual;

    const ok = types.some((t) => {
      if (t === 'integer') {
        return typeof value === 'number' && Number.isInteger(value);
      }
      return t === normalized;
    });

    if (!ok) {
      throw new ToolValidationError(
        `Expected ${path} to be ${types.join('|')}, got ${actual}`
      );
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    throw new ToolValidationError(
      `${path} must be one of: ${schema.enum.map(String).join(', ')}`
    );
  }

  if (types?.includes('object') && value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in obj)) {
        throw new ToolValidationError(`Missing required property: ${path}.${key}`);
      }
    }
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          validateAgainstSchema(obj[key], propSchema, `${path}.${key}`);
        }
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(obj)) {
        if (!(key in schema.properties)) {
          throw new ToolValidationError(`Unexpected property: ${path}.${key}`);
        }
      }
    }
  }

  if (types?.includes('array') && Array.isArray(value) && schema.items && !Array.isArray(schema.items)) {
    value.forEach((item, index) => {
      validateAgainstSchema(item, schema.items as JSONSchema, `${path}[${index}]`);
    });
  }
}

export interface ToolExecutorOptions {
  defaultTimeoutMs?: number;
}

export class ToolExecutor {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly options: ToolExecutorOptions = {}
  ) {}

  async execute(
    call: ToolCallRequest,
    ctx: Omit<ToolExecutionContext, 'toolCallId'>
  ): Promise<ToolCallResult> {
    const started = Date.now();
    const tool = this.registry.get(call.name);

    if (!tool) {
      throw new ToolNotFoundError(call.name);
    }

    try {
      const coercedArgs = coerceValueToSchema(
        call.arguments ?? {},
        tool.inputSchema
      ) as Record<string, unknown>;
      validateAgainstSchema(coercedArgs, tool.inputSchema);
      call = { ...call, arguments: coercedArgs };
    } catch (error) {
      if (error instanceof ToolValidationError) {
        return {
          toolCallId: call.id,
          name: call.name,
          content: { error: error.message, code: error.code },
          isError: true,
          durationMs: Date.now() - started,
        };
      }
      throw error;
    }

    const timeoutMs = tool.timeoutMs ?? this.options.defaultTimeoutMs ?? 10_000;
    const executionCtx: ToolExecutionContext = {
      ...ctx,
      toolCallId: call.id,
    };

    try {
      throwIfAborted(ctx.signal);
      const content = await withTimeout(
        (signal) =>
          Promise.resolve(tool.execute(call.arguments ?? {}, { ...executionCtx, signal })),
        {
          timeoutMs,
          signal: ctx.signal,
          message: `Tool "${call.name}" timed out after ${timeoutMs}ms`,
        }
      );

      return {
        toolCallId: call.id,
        name: call.name,
        content,
        isError: false,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      const normalized = toAIAssistantError(error);
      if (normalized instanceof TimeoutError) {
        throw new ToolExecutionError(`Tool "${call.name}" timed out`, {
          cause: normalized,
          retryable: true,
          details: { toolName: call.name },
        });
      }
      throw new ToolExecutionError(
        `Tool "${call.name}" failed: ${normalized.message}`,
        {
          cause: normalized,
          retryable: false,
          details: { toolName: call.name },
        }
      );
    }
  }
}
