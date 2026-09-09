import { describe, it, expect, afterEach } from 'vitest';
import {
  clearNetworkLogs,
  completeNetworkLog,
  getNetworkLogStats,
  getRecentNetworkLogs,
  markNetworkRequestStart,
  sanitizeNetworkUrl,
  seedSampleNetworkLogs,
} from './networkLogStore';

describe('networkLogStore', () => {
  afterEach(() => {
    clearNetworkLogs();
  });

  it('redacts sensitive query params', () => {
    expect(sanitizeNetworkUrl('/api/x?token=secret&ok=1')).toContain(
      'token=%5BREDACTED%5D'
    );
    expect(sanitizeNetworkUrl('/api/x?token=secret&ok=1')).toContain('ok=1');
  });

  it('tracks request lifecycle', () => {
    const id = markNetworkRequestStart({
      method: 'get',
      url: '/pub/v1/test',
    });
    completeNetworkLog(id, {
      status: 200,
      durationMs: 120,
      phase: 'success',
    });
    const logs = getRecentNetworkLogs(5);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      method: 'GET',
      status: 200,
      phase: 'success',
      durationMs: 120,
    });
  });

  it('computes stats including errors', () => {
    seedSampleNetworkLogs();
    const stats = getNetworkLogStats();
    expect(stats.totalCaptured).toBeGreaterThanOrEqual(3);
    expect(stats.errorCount).toBeGreaterThanOrEqual(1);
  });
});
