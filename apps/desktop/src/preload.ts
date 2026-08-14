import { contextBridge, ipcRenderer } from 'electron';
import type { MarketQueryRequest, MarketQueryResult } from '@warframe-companion/market-query-contract';
import type { SystemHealthSnapshot } from './system-health.js';
import type { AgentStreamEvent, ModelHealth, ModelProfile, OpenAICompatibleProfileInput } from '@warframe-companion/agent-runtime';

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
    run: (request: { requestId: string; message: string; modelProfileId: string; timeoutMs: number }, onEvent: (event: AgentStreamEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, requestId: string, streamEvent: AgentStreamEvent) => {
        if (requestId === request.requestId) onEvent(streamEvent);
      };
      ipcRenderer.on('agent:event', listener);
      ipcRenderer.send('agent:run', request);
      return () => ipcRenderer.removeListener('agent:event', listener);
    },
    cancel: (requestId: string): void => ipcRenderer.send('agent:cancel', requestId),
  },
});
