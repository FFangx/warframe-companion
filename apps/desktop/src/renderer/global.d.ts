import type { SystemHealthSnapshot } from '../system-health.js';
import type { MarketQueryRequest, MarketQueryResult } from '@warframe-companion/market-query-contract';
import type { AgentStreamEvent, ModelHealth, ModelProfile } from '@warframe-companion/agent-runtime';

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
        listModels(): Promise<ModelProfile[]>;
        checkModel(profileId: string): Promise<ModelHealth>;
        run(request: { requestId: string; message: string; modelProfileId: string; timeoutMs: number }, onEvent: (event: AgentStreamEvent) => void): () => void;
        cancel(requestId: string): void;
      };
    };
  }
}

export {};
