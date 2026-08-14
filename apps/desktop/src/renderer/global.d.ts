import type { SystemHealthSnapshot } from '../system-health.js';
import type { MarketQueryRequest, MarketQueryResult } from '@warframe-companion/market-query-contract';
import type { AgentStreamEvent, ModelHealth, ModelProfile, OpenAICompatibleProfileInput } from '@warframe-companion/agent-runtime';

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
        listModels(): Promise<{ profiles: ModelProfile[]; configError?: { code: string; message: string } }>;
        saveModel(profile: OpenAICompatibleProfileInput): Promise<{ ok: true; profile: ModelProfile } | { ok: false; error: { code: string; message: string } }>;
        deleteModel(profileId: string): Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }>;
        checkModel(profileId: string): Promise<ModelHealth>;
        run(request: { requestId: string; message: string; modelProfileId: string; timeoutMs: number }, onEvent: (event: AgentStreamEvent) => void): () => void;
        cancel(requestId: string): void;
      };
    };
  }
}

export {};
