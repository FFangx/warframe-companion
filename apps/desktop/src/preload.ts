import { contextBridge, ipcRenderer } from 'electron';
import type { MarketQueryRequest, MarketQueryResult } from '@warframe-companion/market-query-contract';
import type { SystemHealthSnapshot } from './system-health.js';
import type { ModelHealth, ModelProfile, OpenAICompatibleProfileInput } from '@warframe-companion/agent-runtime';
import type { DesktopAgentEvent, DesktopAgentRequest } from './agent-presentation.js';
import { subscribeAgentRun } from './agent-subscription.js';

contextBridge.exposeInMainWorld('warframeCompanion', {
  system: {
    getHealth: (): Promise<SystemHealthSnapshot> => ipcRenderer.invoke('system:get-health'),
  },
  market: {
    query: (request: MarketQueryRequest): Promise<MarketQueryResult> => ipcRenderer.invoke('market:query', request),
  },
  agent: {
    listModels: (): Promise<{ profiles: ModelProfile[]; configError?: { code: string; message: string } }> => ipcRenderer.invoke('agent:list-models'),
    saveModel: (profile: OpenAICompatibleProfileInput): Promise<{ ok: true; profile: ModelProfile } | { ok: false; error: { code: string; message: string } }> => ipcRenderer.invoke('agent:save-model', profile),
    deleteModel: (profileId: string): Promise<{ ok: true } | { ok: false; error: { code: string; message: string } }> => ipcRenderer.invoke('agent:delete-model', profileId),
    checkModel: (profileId: string): Promise<ModelHealth> => ipcRenderer.invoke('agent:check-model', profileId),
    run: (request: DesktopAgentRequest, onEvent: (event: DesktopAgentEvent) => void): (() => void) => subscribeAgentRun(ipcRenderer, request, onEvent),
    cancel: (requestId: string): void => ipcRenderer.send('agent:cancel', requestId),
  },
});
