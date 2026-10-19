import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { subscribeAgentRun } from '../src/agent-subscription.js';
import type { DesktopAgentEvent } from '../src/agent-presentation.js';

const request = { requestId: 'synthetic-run', message: 'synthetic', modelProfileId: 'synthetic', timeoutMs: 15000 };
const completed: DesktopAgentEvent = {
  type: 'completed', message: 'done',
  trace: { caseId: request.requestId, decision: 'answer', toolCalls: [], facts: [], latencyMs: 1, terminalReason: 'completed' },
};

describe('Agent IPC subscription lifecycle', () => {
  it('filters requests, removes completed listeners, and ignores later events', () => {
    const ipc = Object.assign(new EventEmitter(), { send: vi.fn() });
    const receive = vi.fn();
    const dispose = subscribeAgentRun(ipc, request, receive);
    ipc.emit('agent:event', {}, 'other-run', completed);
    expect(receive).not.toHaveBeenCalled();
    ipc.emit('agent:event', {}, request.requestId, completed);
    expect(receive).toHaveBeenCalledOnce();
    expect(ipc.listenerCount('agent:event')).toBe(0);
    dispose();
    ipc.emit('agent:event', {}, request.requestId, completed);
    expect(receive).toHaveBeenCalledOnce();
    expect(ipc.send).toHaveBeenCalledExactlyOnceWith('agent:run', request);
  });

  it('cleans up when the consumer is disposed before completion', () => {
    const ipc = Object.assign(new EventEmitter(), { send: vi.fn() });
    const receive = vi.fn();
    const dispose = subscribeAgentRun(ipc, request, receive);
    dispose(); dispose();
    ipc.emit('agent:event', {}, request.requestId, completed);
    expect(receive).not.toHaveBeenCalled();
    expect(ipc.listenerCount('agent:event')).toBe(0);
  });

  it('handles synchronous completion and failed sends without leaving listeners', () => {
    const ipc = Object.assign(new EventEmitter(), { send: vi.fn() });
    ipc.send.mockImplementation(() => { ipc.emit('agent:event', {}, request.requestId, completed); });
    subscribeAgentRun(ipc, request, () => {});
    expect(ipc.listenerCount('agent:event')).toBe(0);
    ipc.send.mockImplementation(() => { throw new Error('synthetic-send-error'); });
    expect(() => subscribeAgentRun(ipc, request, () => {})).toThrow('synthetic-send-error');
    expect(ipc.listenerCount('agent:event')).toBe(0);
  });
});
