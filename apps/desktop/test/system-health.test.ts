import { describe, expect, it, vi } from 'vitest';
import { getSystemHealth } from '../src/system-health.js';

const NOW = new Date('2026-08-14T01:02:03.000Z');

describe('getSystemHealth', () => {
  it('returns fresh direct evidence for every configured component', async () => {
    const snapshot = await getSystemHealth({
      appVersion: '0.1.0',
      buildId: 'synthetic-build',
      now: () => NOW,
      environment: {
        WARFRAME_COMPANION_WFINFO_EXE: 'C:\\Synthetic\\WFInfo.exe',
        WARFRAME_COMPANION_ALECAFRAME_DIR: 'C:\\Synthetic\\AlecaFrame',
      },
      tcpProbe: vi.fn().mockResolvedValue(true),
      pathProbe: vi.fn().mockResolvedValue(true),
      fetch: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    });

    expect(snapshot.overall).toBe('healthy');
    expect(snapshot.checkedAt).toBe(NOW.toISOString());
    expect(snapshot.components).toHaveLength(5);
    expect(snapshot.components.every((entry) => entry.status === 'healthy')).toBe(true);
    expect(snapshot.components.every((entry) => entry.evidence.asOf === NOW.toISOString())).toBe(true);
    expect(snapshot.components.find((entry) => entry.id === 'desktop')?.summary).toContain('synthetic-build');
  });

  it('distinguishes missing configuration from an unavailable integration', async () => {
    const snapshot = await getSystemHealth({
      appVersion: '0.1.0',
      buildId: 'development',
      now: () => NOW,
      environment: { WARFRAME_COMPANION_WFINFO_EXE: 'C:\\Missing\\WFInfo.exe' },
      tcpProbe: vi.fn().mockResolvedValue(false),
      pathProbe: vi.fn().mockResolvedValue(false),
      fetch: vi.fn().mockResolvedValue(new Response('', { status: 503 })),
    });

    expect(snapshot.overall).toBe('degraded');
    expect(snapshot.components.find((entry) => entry.id === 'wfinfo')?.status).toBe('unavailable');
    expect(snapshot.components.find((entry) => entry.id === 'alecaframe')?.status).toBe('not_configured');
    expect(snapshot.components.find((entry) => entry.id === 'market')?.status).toBe('unavailable');
    expect(snapshot.components.find((entry) => entry.id === 'openclaw')?.evidence.finding).toBe('unavailable');
  });

  it('classifies a timed out public source as unavailable without throwing', async () => {
    vi.useFakeTimers();
    const pendingFetch = vi.fn((_input: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const promise = getSystemHealth({
      appVersion: '0.1.0',
      buildId: 'development',
      now: () => NOW,
      environment: {},
      timeoutMs: 50,
      tcpProbe: vi.fn().mockResolvedValue(true),
      pathProbe: vi.fn().mockResolvedValue(false),
      fetch: pendingFetch,
    });
    await vi.advanceTimersByTimeAsync(50);
    const snapshot = await promise;
    vi.useRealTimers();

    const market = snapshot.components.find((entry) => entry.id === 'market');
    expect(market?.status).toBe('unavailable');
    expect(market?.summary).toContain('超时');
  });
});
