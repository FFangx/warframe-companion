import {
  assertMarketQueryRequest,
  assertMarketQueryResult,
  type MarketQueryRequest,
  type MarketQueryResult,
} from '@warframe-companion/market-query-contract';
import type { AgentStreamEvent } from '@warframe-companion/agent-runtime';

export interface DesktopAgentRequest {
  requestId: string;
  message: string;
  modelProfileId: string;
  /**
   * 可选：只允许比主进程默认策略更短的显式超时（测试/诊断用）；
   * 不传则使用主进程构造的默认 RunPolicy（120 秒）。
   */
  timeoutMs?: number;
}

// Order identities belong to the desktop session, not model messages or AgentTrace.
export interface MarketPresentationEvent {
  type: 'market_result';
  snapshotId: string | null;
  request: MarketQueryRequest;
  result: MarketQueryResult;
}
export type DesktopAgentEvent = AgentStreamEvent | MarketPresentationEvent;

export type MarketSnapshotRegistrar = (request: MarketQueryRequest, result: MarketQueryResult) => string | null;

export function withMarketPresentation(
  query: (request: MarketQueryRequest) => Promise<MarketQueryResult>,
  present: (event: MarketPresentationEvent) => void,
  signal: AbortSignal,
  register?: MarketSnapshotRegistrar,
): (request: MarketQueryRequest) => Promise<MarketQueryResult> {
  return async (request) => {
    const result = await query(request);
    if (!signal.aborted) {
      assertMarketQueryRequest(request);
      assertMarketQueryResult(result);
      present({
        type: 'market_result',
        snapshotId: register ? register(request, result) : null,
        request,
        result,
      });
    }
    return result;
  };
}
