import type { DesktopAgentEvent, DesktopAgentRequest } from './agent-presentation.js';

type Listener = (event: unknown, requestId: string, payload: DesktopAgentEvent) => void;
interface AgentIpc {
  on(channel: string, listener: Listener): unknown;
  removeListener(channel: string, listener: Listener): unknown;
  send(channel: string, request: DesktopAgentRequest | string): void;
}

export function subscribeAgentRun(
  ipc: AgentIpc,
  request: DesktopAgentRequest,
  onEvent: (event: DesktopAgentEvent) => void,
): () => void {
  let listening = true;
  const dispose = () => {
    if (!listening) return;
    listening = false;
    ipc.removeListener('agent:event', listener);
  };
  const listener: Listener = (_event, requestId, payload) => {
    if (!listening || requestId !== request.requestId) return;
    if (payload.type === 'completed') dispose();
    onEvent(payload);
  };
  ipc.on('agent:event', listener);
  try { ipc.send('agent:run', request); }
  catch (error) { dispose(); throw error; }
  return dispose;
}
