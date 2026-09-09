import { describe, expect, it } from 'vitest';
import { ToolRegistry } from './ToolRegistry';
import { ToolExecutor, validateAgainstSchema } from './ToolExecutor';
import { ConfigurationError, ToolNotFoundError } from '../errors/errors';

describe('ToolRegistry', () => {
  it('registers and lists tools without execute leakage in provider view', () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'getNetworkInfo',
      description: 'network',
      execute: async () => ({ ok: true }),
    });

    expect(registry.size).toBe(1);
    expect(registry.toProviderTools()[0]).toEqual({
      name: 'getNetworkInfo',
      description: 'network',
      inputSchema: undefined,
    });
    expect(registry.unregister('getNetworkInfo')).toBe(true);
  });

  it('rejects duplicate registration', () => {
    const registry = new ToolRegistry();
    const tool = {
      name: 'a',
      description: 'd',
      execute: async () => null,
    };
    registry.register(tool);
    expect(() => registry.register(tool)).toThrow(ConfigurationError);
  });
});

describe('validateAgainstSchema', () => {
  it('validates required object properties', () => {
    expect(() =>
      validateAgainstSchema(
        {},
        { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }
      )
    ).toThrow(/Missing required/);
  });

  it('accepts valid payloads', () => {
    expect(() =>
      validateAgainstSchema(
        { id: '1' },
        { type: 'object', required: ['id'], properties: { id: { type: 'string' } } }
      )
    ).not.toThrow();
  });
});

describe('ToolExecutor', () => {
  it('executes a registered tool', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'echo',
      description: 'echo',
      inputSchema: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
      },
      execute: async (input) => input,
    });
    const executor = new ToolExecutor(registry);
    const result = await executor.execute(
      { id: '1', name: 'echo', arguments: { value: 'hi' } },
      { sessionId: 's' }
    );
    expect(result.isError).toBe(false);
    expect(result.content).toEqual({ value: 'hi' });
  });

  it('returns validation error result for bad input', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'echo',
      description: 'echo',
      inputSchema: {
        type: 'object',
        required: ['value'],
        properties: { value: { type: 'string' } },
      },
      execute: async () => null,
    });
    const executor = new ToolExecutor(registry);
    const result = await executor.execute(
      { id: '1', name: 'echo', arguments: {} },
      { sessionId: 's' }
    );
    expect(result.isError).toBe(true);
  });

  it('throws when tool is missing', async () => {
    const executor = new ToolExecutor(new ToolRegistry());
    await expect(
      executor.execute({ id: '1', name: 'missing', arguments: {} }, { sessionId: 's' })
    ).rejects.toBeInstanceOf(ToolNotFoundError);
  });
});
