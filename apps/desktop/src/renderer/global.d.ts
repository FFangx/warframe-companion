import type { SystemHealthSnapshot } from '../system-health.js';

declare global {
  interface Window {
    warframeCompanion: {
      system: {
        getHealth(): Promise<SystemHealthSnapshot>;
      };
    };
  }
}

export {};
