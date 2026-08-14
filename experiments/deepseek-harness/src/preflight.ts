import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDshRuntime } from './dsh-driver.js';
import { DSH_MARKET_TOOL, DSH_SUBMIT_TOOL, installCompanionEvalPlugin } from './plugin.js';
import type { AgentEvalCase } from './types.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'deepseek-harness');
const testCase: AgentEvalCase = {
  id: 'preflight', category: 'tool-routing', prompt: 'synthetic preflight',
  context: { channel: 'desktop', trustedOwner: true, now: '2030-01-02T03:04:05.000Z' },
  availableTools: ['market.query'],
};

const runtime = await loadDshRuntime(root);
const ctx = new runtime.Context();
try {
  await ctx.plugin(runtime.LlmRuntime);
  await ctx.plugin(runtime.SessionStore);
  await ctx.plugin(runtime.SystemPrompt, { persona: 'Keyless Companion plugin preflight.' });
  await ctx.plugin(runtime.ToolRuntime, { mode: 'native' });
  await ctx.plugin(runtime.AgentRegistry);
  await ctx.plugin(runtime.AgentLoop, { agents: [] });
  await ctx.plugin(runtime.DeepSeekPlugin, {
    thinking: 'disabled', reasoningEffort: 'off', maxTokens: 2_048,
    models: [{ id: 'deepseek-v4-flash' }],
  });
  installCompanionEvalPlugin(ctx, {
    testCase,
    defineTool: runtime.defineTool,
    executeMarket: async () => ({ ok: true, synthetic: true }),
    acceptSubmission: () => {},
  });
  const names = ctx.tools.schemas().map((entry: { name: string }) => entry.name);
  if (!names.includes(DSH_MARKET_TOOL) || !names.includes(DSH_SUBMIT_TOOL)) {
    throw new Error('Companion DSH tools were not registered');
  }
  process.stdout.write(`Keyless DSH preflight: ${names.join(', ')}\n`);
} finally {
  await ctx.fiber.dispose();
}
