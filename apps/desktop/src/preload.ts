import { contextBridge, ipcRenderer } from 'electron';
import type { MarketQueryRequest, MarketQueryResult } from '@warframe-companion/market-query-contract';
import type { SystemHealthSnapshot } from './system-health.js';
import type { AgentStreamEvent } from '@warframe-companion/agent-runtime';

contextBridge.exposeInMainWorld('warframeCompanion', {
  system: {
    getHealth: (): Promise<SystemHealthSnapshot> => ipcRenderer.invoke('system:get-health'),
  },
  market: {
    query: (request: MarketQueryRequest): Promise<MarketQueryResult> => ipcRenderer.invoke('market:query', request),
  },
  agent: {
    run: (request: { requestId: string; message: string }, onEvent: (event: AgentStreamEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, requestId: string, streamEvent: AgentStreamEvent) => {
        if (requestId === request.requestId) onEvent(streamEvent);
      };
      ipcRenderer.on('agent:event', listener);
      ipcRenderer.send('agent:run', request);
      return () => ipcRenderer.removeListener('agent:event', listener);
    },
  },
});
