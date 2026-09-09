import { describe, expect, it } from 'vitest';
import { ContextRegistry } from './ContextRegistry';

describe('ContextRegistry', () => {
  it('collects providers by priority', async () => {
    const registry = new ContextRegistry();
    registry.register({
      name: 'low',
      priority: 1,
      getContext: () => ({ a: 1, shared: 'low' }),
    });
    registry.register({
      name: 'high',
      priority: 10,
      getContext: async () => ({ b: 2, shared: 'high' }),
    });

    const collected = await registry.collect();
    expect(collected.byProvider.high).toEqual({ b: 2, shared: 'high' });
    expect(collected.merged.shared).toBe('low'); // low merged later overwrites
    expect(collected.merged.a).toBe(1);
    expect(collected.merged.b).toBe(2);
  });

  it('skips disabled providers', async () => {
    const registry = new ContextRegistry();
    registry.register({
      name: 'x',
      getContext: () => ({ x: 1 }),
    });
    registry.setEnabled('x', false);
    const collected = await registry.collect();
    expect(collected.byProvider).toEqual({});
  });

  it('records provider errors without failing all', async () => {
    const registry = new ContextRegistry();
    registry.register({
      name: 'bad',
      getContext: () => {
        throw new Error('nope');
      },
    });
    registry.register({
      name: 'good',
      getContext: () => ({ ok: true }),
    });
    const collected = await registry.collect();
    expect(collected.errors[0]?.provider).toBe('bad');
    expect(collected.byProvider.good).toEqual({ ok: true });
  });

  it('truncates when exceeding global budget', async () => {
    const registry = new ContextRegistry({ maxTotalBytes: 40 });
    registry.register({
      name: 'big',
      priority: 10,
      getContext: () => ({ payload: 'x'.repeat(100) }),
    });
    registry.register({
      name: 'small',
      priority: 1,
      getContext: () => ({ y: 1 }),
    });
    const collected = await registry.collect();
    expect(collected.truncatedProviders.length).toBeGreaterThan(0);
  });
});
