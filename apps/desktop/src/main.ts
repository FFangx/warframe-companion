import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import { createWarframeMarketQueryService } from '@warframe-companion/market-query-service';
import {
  checkModelProfile,
  listModelProfiles,
  runDesktopAgent,
  type AgentStreamEvent,
} from '@warframe-companion/agent-runtime';
import { getSystemHealth } from './system-health.js';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

const currentDirectory = __dirname;
const marketQueryService = createWarframeMarketQueryService();

const activeAgentRuns = new Map<string, AbortController>();

function validAgentInput(value: unknown): value is { requestId: string; message: string; modelProfileId?: string; timeoutMs?: number } {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  return typeof input.requestId === 'string' && /^[a-zA-Z0-9-]{1,80}$/u.test(input.requestId)
    && typeof input.message === 'string' && input.message.trim().length > 0 && input.message.length <= 500
    && (input.modelProfileId === undefined || (typeof input.modelProfileId === 'string' && /^[a-z0-9-]{1,80}$/u.test(input.modelProfileId)))
    && (input.timeoutMs === undefined || (Number.isInteger(input.timeoutMs) && Number(input.timeoutMs) >= 100 && Number(input.timeoutMs) <= 60_000));
}

function systemHealth(): ReturnType<typeof getSystemHealth> {
  return getSystemHealth({
    appVersion: app.getVersion(),
    buildId: process.env.WARFRAME_COMPANION_BUILD_ID?.trim() || 'development',
  });
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0b1018',
    title: 'Warframe Companion',
    webPreferences: {
      preload: path.join(currentDirectory, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void window.loadFile(path.join(currentDirectory, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ipcMain.handle('system:get-health', systemHealth);
  ipcMain.handle('market:query', (_event, request: unknown) => marketQueryService.query(request));
  ipcMain.handle('agent:list-models', () => listModelProfiles());
  ipcMain.handle('agent:check-model', (_event, profileId: unknown) => (
    typeof profileId === 'string' ? checkModelProfile(profileId) : checkModelProfile('')
  ));
  ipcMain.on('agent:cancel', (_event, requestId: unknown) => {
    if (typeof requestId === 'string') activeAgentRuns.get(requestId)?.abort(new Error('cancelled'));
  });
  ipcMain.on('agent:run', (event, input: unknown) => {
    if (!validAgentInput(input)) return;
    const send = (streamEvent: AgentStreamEvent) => {
      if (!event.sender.isDestroyed()) event.sender.send('agent:event', input.requestId, streamEvent);
    };
    const controller = new AbortController();
    activeAgentRuns.get(input.requestId)?.abort(new Error('replaced'));
    activeAgentRuns.set(input.requestId, controller);
    void runDesktopAgent({
      requestId: input.requestId,
      message: input.message.trim(),
      ...(input.modelProfileId ? { modelProfileId: input.modelProfileId } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      context: { channel: 'desktop', trustedOwner: true, now: new Date().toISOString() },
    }, { marketQuery: (request) => marketQueryService.query(request), onEvent: send, signal: controller.signal }).catch(() => {
      void send({
        type: 'completed', message: 'Agent 编排器发生内部错误，请稍后重试。',
        trace: { caseId: input.requestId, decision: 'answer', toolCalls: [], facts: [], latencyMs: 0, terminalReason: 'error', ...(input.modelProfileId ? { modelProfileId: input.modelProfileId } : {}) },
      });
    }).finally(() => {
      if (activeAgentRuns.get(input.requestId) === controller) activeAgentRuns.delete(input.requestId);
    });
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
