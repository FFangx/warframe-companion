import type { SystemHealthSnapshot } from '../system-health.js';
import type { MarketQueryRequest } from '@warframe-companion/market-query-contract';
import type { ModelHealth, ModelProfile, OpenAICompatibleProfileInput } from '@warframe-companion/agent-runtime';
import type { DesktopAgentEvent, DesktopAgentRequest } from '../agent-presentation.js';
import type {
  MarketQueryResultEnvelope,
  OrderActionRequest,
  OrderCopyResult,
  OrderPreviewResult,
} from '../market-order-actions.js';

declare global {
  interface Window {
    warframeCompanion: {
      system: {
        getHealth(): Promise<SystemHealthSnapshot>;
      };
      market: {
        query(request: MarketQueryRequest): Promise<MarketQueryResultEnvelope>;
        previewOrder(input: OrderActionRequest): Promise<OrderPreviewResult>;
        copyOrder(input: OrderActionRequest): Promise<OrderCopyResult>;
      };
      agent: {
        listModels(): Promise<{ profiles: ModelProfile[]; configError?: { code: string; message: string } }>;
        saveModel(profile: OpenAICompatibleProfileInput): Promise<{ ok: true; profile: ModelProfile } | { ok: false; error: { code: string; message: string } }>;
        deleteModel(profileId: string): Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }>;
        checkModel(profileId: string): Promise<ModelHealth>;
        run(request: DesktopAgentRequest, onEvent: (event: DesktopAgentEvent) => void): () => void;
        cancel(requestId: string): void;
      };
    };
  }
}

export {};
