import { contextBridge, ipcRenderer } from 'electron';
import type { SystemHealthSnapshot } from './system-health.js';

contextBridge.exposeInMainWorld('warframeCompanion', {
  system: {
    getHealth: (): Promise<SystemHealthSnapshot> => ipcRenderer.invoke('system:get-health'),
  },
});
