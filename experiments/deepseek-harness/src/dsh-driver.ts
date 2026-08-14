import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { buildEvalInstructions, installCompanionEvalPlugin } from './plugin.js';
import { assertSubmissionConsistent, createAgentTraceFromDsh, observeToolResult } from './trace-adapter.js';
import type { AgentEvalCase, AgentTrace, SessionEventLike, ToolResultObservation, TraceSubmission } from './types.js';

type AnyModule = Record<string, unknown>;

function stableDiagnostics(value: unknown, prefix = '', depth = 0, output = new Set<string>()): Set<string> {
  if (depth > 8 || !value || typeof value !== 'object') return output;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof entry === 'string' && ['code', 'kind', 'type', 'reason', 'name', 'message'].includes(key)) {
      const sanitized = entry
        .replace(/sk-[A-Za-z0-9_-]{8,}/gu, '[REDACTED_KEY]')
        .replace(/Bearer\s+\S+/giu, 'Bearer [REDACTED]');
      output.add(`${path}=${sanitized.slice(0, 240)}`);
    } else if (entry && typeof entry === 'object') {
      stableDiagnostics(entry, path, depth + 1, output);
    }
  }
  return output;
}

export function assertTerminalSubmission(
  caseId: string,
  submission: TraceSubmission | undefined,
  events: SessionEventLike[],
): asserts submission is TraceSubmission {
  if (submission) return;
  const eventTypes = [...new Set(events.map((event) => event.type))].join(',');
  const diagnostics = [...stableDiagnostics(events
    .filter((event) => event.type === 'assistant/chunk' || event.type === 'turn/end')
    .map((event) => event.data))].join(';');
  throw new Error(
    `DSH case ${caseId} ended without ${'submit_agent_trace'}; `
    + `diagnostics=${diagnostics || 'none'}; events=${eventTypes || 'none'}`,
  );
}

function callable<T>(value: unknown, label: string): T {
  if (typeof value !== 'function') throw new TypeError(`DSH module missing ${label}`);
  return value as T;
}

async function importFromDsh(dshRoot: string, packageName: string): Promise<AnyModule> {
  // pnpm's workspace-wide virtual node_modules contains every built package;
  // individual product leaves intentionally expose only their own closure.
  const require = createRequire(resolve(dshRoot, 'node_modules', '.pnpm', 'node_modules', '__companion__.cjs'));
  const entry = require.resolve(packageName);
  return import(pathToFileURL(entry).href) as Promise<AnyModule>;
}

export interface DshIdentity {
  commit: string;
  version: string;
  provider: 'deepseek-official';
  model: 'deepseek-v4-flash';
  baseUrlClass: 'official_default' | 'configured_override';
}

export async function loadDshRuntime(dshRoot: string) {
  const [cordis, llm, session, systemPrompt, tools, agent, agentLoop, deepseek] = await Promise.all([
    importFromDsh(dshRoot, '@deepseek-ai/cordis'),
    importFromDsh(dshRoot, '@deepseek-ai/dsh-llm'),
    importFromDsh(dshRoot, '@deepseek-ai/dsh-session'),
    importFromDsh(dshRoot, '@deepseek-ai/dsh-system-prompt'),
    importFromDsh(dshRoot, '@deepseek-ai/dsh-tools'),
    importFromDsh(dshRoot, '@deepseek-ai/dsh-agent'),
    importFromDsh(dshRoot, '@deepseek-ai/dsh-agent-loop'),
    importFromDsh(dshRoot, '@deepseek-ai/dsh-llm-deepseek'),
  ]);
  return {
    Context: callable<new () => any>(cordis.Context, 'Context'),
    LlmRuntime: callable<any>(llm.default, 'LlmRuntime'),
    createUserMessage: callable<(input: unknown) => unknown>(llm.createUserMessage, 'createUserMessage'),
    SessionStore: callable<any>(session.default, 'SessionStore'),
    SessionId: callable<(id: string) => unknown>(session.SessionId, 'SessionId'),
    SystemPrompt: callable<any>(systemPrompt.default, 'SystemPrompt'),
    ToolRuntime: callable<any>(tools.default, 'ToolRuntime'),
    defineTool: callable<(definition: Record<string, unknown>) => Record<string, unknown>>(tools.defineTool, 'defineTool'),
    AgentRegistry: callable<any>(agent.default, 'AgentRegistry'),
    AgentLoop: callable<any>(agentLoop.default, 'AgentLoop'),
    DeepSeekPlugin: deepseek,
  };
}

export function waitForAgentCycle(ctx: any, subject: any, timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    let sawRunning = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        dispose();
        reject(new Error(`DSH case timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    const dispose = ctx.on('agent/status', ({ agent, status }: { agent: unknown; status: string }) => {
      if (agent !== subject || settled) return;
      if (status === 'running') sawRunning = true;
      if (sawRunning && status === 'idle') {
        settled = true;
        clearTimeout(timer);
        dispose();
        resolvePromise();
      }
    });
  });
}

export async function runDshCase(options: {
  dshRoot: string;
  testCase: AgentEvalCase;
  marketFixture: unknown;
  timeoutMs?: number;
}): Promise<AgentTrace> {
  const runtime = await loadDshRuntime(options.dshRoot);
  const ctx = new runtime.Context();
  const events: SessionEventLike[] = [];
  const toolResults: ToolResultObservation[] = [];
  let submission: TraceSubmission | undefined;
  const sessionId = runtime.SessionId(`warframe-companion-${options.testCase.id}-${Date.now()}`);
  try {
    await ctx.plugin(runtime.LlmRuntime);
    await ctx.plugin(runtime.SessionStore);
    await ctx.plugin(runtime.SystemPrompt, {
      persona: buildEvalInstructions(options.testCase),
    });
    await ctx.plugin(runtime.ToolRuntime, { mode: 'native' });
    await ctx.plugin(runtime.AgentRegistry);
    await ctx.plugin(runtime.AgentLoop, { agents: [] });
    await ctx.plugin(runtime.DeepSeekPlugin, {
      thinking: 'disabled', reasoningEffort: 'off', maxTokens: 2_048,
      models: [{ id: 'deepseek-v4-flash' }],
    });
    installCompanionEvalPlugin(ctx, {
      testCase: options.testCase,
      defineTool: runtime.defineTool,
      executeMarket: async () => structuredClone(options.marketFixture),
      acceptSubmission: (value) => { submission = value; },
    });
    ctx.on('session/event', (session: { id: unknown }, event: SessionEventLike) => {
      if (String(session.id) === String(sessionId)) events.push(structuredClone(event));
    });
    ctx.on('tools/result', (execution: unknown, result: unknown) => {
      const observed = observeToolResult(execution, result);
      if (observed) toolResults.push(observed);
    });
    const agent = ctx.agentLoop.create(sessionId, { provider: 'deepseek-official', model: 'deepseek-v4-flash' });
    // Agent creation publishes an initial idle state. Completion is valid only
    // after this submitted follow-up has crossed the running -> idle cycle.
    const idle = waitForAgentCycle(ctx, agent, options.timeoutMs ?? 180_000);
    const startedAt = Date.now();
    agent.followup(runtime.createUserMessage({
      content: [{ type: 'text', text: options.testCase.prompt }],
      source: { kind: 'user' },
    }));
    await idle;
    assertTerminalSubmission(options.testCase.id, submission, events);
    const trace = createAgentTraceFromDsh({
      caseId: options.testCase.id,
      events,
      toolResults,
      submission,
      startedAt,
      finishedAt: Date.now(),
    });
    assertSubmissionConsistent(trace, toolResults);
    return trace;
  } finally {
    await ctx.fiber.dispose();
  }
}
