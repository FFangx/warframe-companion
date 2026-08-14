import { contextBridge, ipcRenderer } from 'electron';
import type { MarketQueryRequest, MarketQueryResult } from '@warframe-companion/market-query-contract';
import type { SystemHealthSnapshot } from './system-health.js';

contextBridge.exposeInMainWorld('warframeCompanion', {
  system: {
    getHealth: (): Promise<SystemHealthSnapshot> => ipcRenderer.invoke('system:get-health'),
  },
  market: {
    query: (request: MarketQueryRequest): Promise<MarketQueryResult> => ipcRenderer.invoke('market:query', request),
  },
});
