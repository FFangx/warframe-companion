import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { buildEvalInstructions, installCompanionEvalPlugin } from './plugin.js';
import { assertSubmissionConsistent, createAgentTraceFromDsh, observeToolResult } from './trace-adapter.js';
import type { AgentEvalCase, AgentTrace, SessionEventLike, ToolResultObservation, TraceSubmission } from './types.js';

type AnyModule = Record<string, unknown>;

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
    AgentRegistry: callable<any>(agent.default, 'AgentRegistry'),
    AgentLoop: callable<any>(agentLoop.default, 'AgentLoop'),
    DeepSeekPlugin: deepseek,
  };
}

function waitForIdle(ctx: any, subject: any, timeoutMs: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        dispose();
        reject(new Error(`DSH case timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    const dispose = ctx.on('agent/status', ({ agent, status }: { agent: unknown; status: string }) => {
      if (!settled && agent === subject && status === 'idle') {
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
    const idle = waitForIdle(ctx, agent, options.timeoutMs ?? 180_000);
    const startedAt = Date.now();
    agent.followup(runtime.createUserMessage({
      content: [{ type: 'text', text: options.testCase.prompt }],
      source: { kind: 'user' },
    }));
    await idle;
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
