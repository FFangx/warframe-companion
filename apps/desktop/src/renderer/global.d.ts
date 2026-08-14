import type { SystemHealthSnapshot } from '../system-health.js';
import type { MarketQueryRequest, MarketQueryResult } from '@warframe-companion/market-query-contract';
import type { AgentStreamEvent } from '@warframe-companion/agent-runtime';

declare global {
  interface Window {
    warframeCompanion: {
      system: {
        getHealth(): Promise<SystemHealthSnapshot>;
      };
      market: {
        query(request: MarketQueryRequest): Promise<MarketQueryResult>;
      };
      agent: {
        run(request: { requestId: string; message: string }, onEvent: (event: AgentStreamEvent) => void): () => void;
      };
    };
  }
}

export {};
