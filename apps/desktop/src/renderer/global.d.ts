import type { SystemHealthSnapshot } from '../system-health.js';
import type { MarketQueryRequest, MarketQueryResult } from '@warframe-companion/market-query-contract';

declare global {
  interface Window {
    warframeCompanion: {
      system: {
        getHealth(): Promise<SystemHealthSnapshot>;
      };
      market: {
        query(request: MarketQueryRequest): Promise<MarketQueryResult>;
      };
    };
  }
}

export {};
