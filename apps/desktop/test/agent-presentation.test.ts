import { describe, expect, it, vi } from 'vitest';
import { runDesktopAgent, type AgentStreamEvent } from '@warframe-companion/agent-runtime';
import type { MarketQueryRequest } from '@warframe-companion/market-query-contract';
import {
  MOCK_MARKET_QUERY_REQUEST,
  MOCK_MARKET_QUERY_SUCCESS,
  MOCK_MARKET_QUERY_NO_ORDERS,
  MOCK_MARKET_QUERY_FAILURES,
} from '@warframe-companion/market-query-contract/mocks';
import { withMarketPresentation } from '../src/agent-presentation.js';

describe('desktop-only market presentation', () => {
  it('renders the same query result without duplicating calls or adding order identities to runtime events/trace', async () => {
    const query = vi.fn(async (_request: MarketQueryRequest) => structuredClone(MOCK_MARKET_QUERY_SUCCESS));
    const present = vi.fn();
    const events: AgentStreamEvent[] = [];
    const output = await runDesktopAgent({
      requestId: 'synthetic-desktop', message: '查一下示例 Prime 蓝图当前行情，PC 跨平台，0级。',
      context: { channel: 'desktop', trustedOwner: true, now: '2030-01-02T03:04:05Z' },
    }, {
      marketQuery: withMarketPresentation(query, present, new AbortController().signal),
      onEvent: (event) => { events.push(event); },
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(present).toHaveBeenCalledTimes(1);
    expect(present.mock.calls[0]?.[0].result).toEqual(MOCK_MARKET_QUERY_SUCCESS);
    expect(present.mock.calls[0]?.[0].request).toEqual(query.mock.calls[0]?.[0]);
    expect(present.mock.calls[0]?.[0].snapshotId).toBeNull();
    expect(JSON.stringify({ output, events })).not.toContain('SyntheticTenno');
    // Seller reputation/locale are presentation-only metadata: the runtime
    // events, facts and trace must never carry them.
    expect(JSON.stringify(output)).not.toMatch(/(?:reputation|locale|zh-hans)/u);
    expect(output.trace.terminalReason).not.toBe('error');
  });

  it('attaches the main-process snapshot id to the desktop presentation event', async () => {
    const present = vi.fn();
    const register = vi.fn(() => 'snap-synthetic-1');
    const query = withMarketPresentation(async () => MOCK_MARKET_QUERY_SUCCESS, present, new AbortController().signal, register);
    await query(MOCK_MARKET_QUERY_REQUEST);
    expect(register).toHaveBeenCalledWith(MOCK_MARKET_QUERY_REQUEST, MOCK_MARKET_QUERY_SUCCESS);
    expect(present.mock.calls[0]?.[0]).toMatchObject({ type: 'market_result', snapshotId: 'snap-synthetic-1' });
  });

  it.each([MOCK_MARKET_QUERY_NO_ORDERS, MOCK_MARKET_QUERY_FAILURES.unavailable])('preserves empty vs failed results', async (result) => {
    const present = vi.fn();
    const query = withMarketPresentation(async () => result, present, new AbortController().signal);
    expect(await query(MOCK_MARKET_QUERY_REQUEST)).toBe(result);
    expect(present).toHaveBeenCalledWith({ type: 'market_result', snapshotId: null, request: MOCK_MARKET_QUERY_REQUEST, result });
  });

  it('drops a late presentation when its run has ended or been cancelled', async () => {
    const controller = new AbortController();
    const present = vi.fn();
    let resolve!: (result: typeof MOCK_MARKET_QUERY_SUCCESS) => void;
    const result = new Promise<typeof MOCK_MARKET_QUERY_SUCCESS>((done) => { resolve = done; });
    const pending = withMarketPresentation(() => result, present, controller.signal)(MOCK_MARKET_QUERY_REQUEST);
    controller.abort();
    resolve(MOCK_MARKET_QUERY_SUCCESS);
    await pending;
    expect(present).not.toHaveBeenCalled();
  });

  it('does not register a late market snapshot after its phase signal is cancelled', async () => {
    const controller = new AbortController();
    const present = vi.fn();
    const register = vi.fn(() => 'late-snapshot');
    let resolve!: (result: typeof MOCK_MARKET_QUERY_SUCCESS) => void;
    const result = new Promise<typeof MOCK_MARKET_QUERY_SUCCESS>((done) => { resolve = done; });
    const pending = withMarketPresentation(() => result, present, controller.signal, register)(MOCK_MARKET_QUERY_REQUEST);
    controller.abort(new Error('phase timeout'));
    resolve(MOCK_MARKET_QUERY_SUCCESS);
    await pending;
    expect(present).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });
});
