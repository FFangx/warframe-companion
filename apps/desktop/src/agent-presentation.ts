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
  timeoutMs: number;
}

// Order identities belong to the desktop session, not model messages or AgentTrace.
export interface MarketPresentationEvent {
  type: 'market_result';
  request: MarketQueryRequest;
  result: MarketQueryResult;
}
export type DesktopAgentEvent = AgentStreamEvent | MarketPresentationEvent;

export function withMarketPresentation(
  query: (request: MarketQueryRequest) => Promise<MarketQueryResult>,
  present: (event: MarketPresentationEvent) => void,
  signal: AbortSignal,
): (request: MarketQueryRequest) => Promise<MarketQueryResult> {
  return async (request) => {
    const result = await query(request);
    if (!signal.aborted) {
      assertMarketQueryRequest(request);
      assertMarketQueryResult(result);
      present({ type: 'market_result', request, result });
    }
    return result;
  };
}
