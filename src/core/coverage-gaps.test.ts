import { describe, expect, it, vi } from 'vitest';
import { createAIAssistant } from './AIAssistant';
import { MockAIProvider } from '../providers/MockAIProvider';
import { ToolExecutionError } from '../errors/errors';
import { ToolRegistry } from '../tools/ToolRegistry';
import { ToolExecutor } from '../tools/ToolExecutor';
import { createCancelScope, throwIfAborted, onAbort } from '../utils/cancellation';
import { createId, byteLengthOf, deepClone } from '../utils/id';
import { createSensitiveDataFilter } from '../security/SensitiveDataFilter';
import { ContextRegistry } from '../context/ContextRegistry';
import { ConfigurationError } from '../errors/errors';

describe('additional coverage', () => {
  it('registers and unregisters context providers', () => {
    const assistant = createAIAssistant({
      provider: new MockAIProvider({ responses: ['ok'] }),
    });
    assistant.registerContextProvider({
      name: 'app',
      getContext: () => ({ v: 1 }),
    });
    expect(assistant.unregisterContextProvider('app')).toBe(true);
    expect(assistant.unregisterTool('missing')).toBe(false);
  });

  it('tool timeout surfaces as ToolExecutionError', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'slow',
      description: 'slow',
      timeoutMs: 20,
      execute: async (_input, ctx) =>
        new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve('late'), 200);
          ctx.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(ctx.signal?.reason ?? new Error('aborted'));
          });
        }),
    });
    const executor = new ToolExecutor(registry);
    await expect(
      executor.execute({ id: '1', name: 'slow', arguments: {} }, { sessionId: 's' })
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });

  it('tool execute exceptions become ToolExecutionError', async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: 'boom',
      description: 'boom',
      execute: async () => {
        throw new Error('explode');
      },
    });
    const executor = new ToolExecutor(registry);
    await expect(
      executor.execute({ id: '1', name: 'boom', arguments: {} }, { sessionId: 's' })
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });

  it('throwIfAborted and onAbort helpers', () => {
    expect(() => throwIfAborted(undefined)).not.toThrow();
    const scope = createCancelScope();
    const cb = vi.fn();
    const detach = onAbort(scope.signal, cb);
    scope.cancel();
    expect(cb).toHaveBeenCalled();
    detach();
    expect(() => throwIfAborted(scope.signal)).toThrow();
  });

  it('createId / byteLengthOf / deepClone utilities', () => {
    expect(createId('x')).toMatch(/^x_/);
    expect(byteLengthOf({ a: 1 })).toBeGreaterThan(0);
    expect(byteLengthOf(undefined as unknown as object)).toBeGreaterThanOrEqual(0);
    expect(deepClone({ a: 1 })).toEqual({ a: 1 });
  });

  it('createSensitiveDataFilter factory', () => {
    const filter = createSensitiveDataFilter({ blockedFields: ['pin'] });
    expect(filter.redact({ pin: '1', ok: true })).toEqual({
      pin: '[REDACTED]',
      ok: true,
    });
  });

  it('context registry unregister and get', () => {
    const registry = new ContextRegistry();
    registry.register({ name: 'n', getContext: () => ({}) });
    expect(registry.get('n')?.name).toBe('n');
    expect(registry.unregister('n')).toBe(true);
    expect(registry.size).toBe(0);
    expect(() => registry.setEnabled('missing', true)).toThrow(ConfigurationError);
  });

  it('per-provider maxBytes truncation', async () => {
    const registry = new ContextRegistry();
    registry.register({
      name: 'big',
      maxBytes: 10,
      getContext: () => ({ data: 'abcdefghijklmnop' }),
    });
    const collected = await registry.collect();
    expect(collected.truncatedProviders).toContain('big');
    expect(collected.byProvider.big).toMatchObject({ _truncated: true });
  });

  it('rejects non-object context', async () => {
    const registry = new ContextRegistry();
    registry.register({
      name: 'bad',
      // @ts-expect-error intentional bad return
      getContext: () => 'nope',
    });
    const collected = await registry.collect();
    expect(collected.errors[0]?.provider).toBe('bad');
  });

  it('streamMessage onComplete path', async () => {
    const assistant = createAIAssistant({
      provider: new MockAIProvider({ responses: ['streamed'] }),
    });
    const session = assistant.createSession();
    let completed = '';
    const handle = session.streamMessage('hi', {
      onComplete: (r) => {
        completed = r.message.content;
      },
    });
    await handle.promise;
    expect(completed).toBe('streamed');
    expect(session.getMetadata()).toEqual({});
    session.clear();
    expect(session.getHistory()).toHaveLength(0);
  });

  it('max tool rounds error', async () => {
    const provider = new MockAIProvider({
      scenarios: [
        { type: 'tool_calls', toolCalls: [{ name: 'loop' }] },
        { type: 'tool_calls', toolCalls: [{ name: 'loop' }] },
        { type: 'tool_calls', toolCalls: [{ name: 'loop' }] },
      ],
    });
    const assistant = createAIAssistant({
      provider,
      session: { maxToolRounds: 1 },
      retry: { maxRetries: 0 },
    });
    assistant.registerTool({
      name: 'loop',
      description: 'loop',
      execute: async () => ({ ok: true }),
    });
    await expect(assistant.createSession().sendMessage('x')).rejects.toMatchObject({
      code: 'AI_MAX_TOOL_ROUNDS',
    });
  });

  it('tool registry validation errors', () => {
    const registry = new ToolRegistry();
    expect(() =>
      registry.register({ name: '', description: 'd', execute: async () => null })
    ).toThrow(ConfigurationError);
    expect(() =>
      registry.register({
        name: 't',
        description: '',
        execute: async () => null,
      })
    ).toThrow(ConfigurationError);
    registry.register({
      name: 't',
      description: 'd',
      execute: async () => null,
    });
    registry.clear();
    expect(registry.size).toBe(0);
  });
});
