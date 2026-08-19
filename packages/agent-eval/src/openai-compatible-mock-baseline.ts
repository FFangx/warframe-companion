import {
  DEFAULT_MODEL_PROFILES,
  createOpenAICompatibleAdapter,
  createOpenAICompatibleProfile,
  localRulesModelAdapter,
  runDesktopAgent,
  type AgentTrace,
  type ModelTurn,
} from '@warframe-companion/agent-runtime';
import type { AgentEvalCase } from './index.js';
import { MOCK_MARKET_QUERY_REQUEST } from '@warframe-companion/market-query-contract/mocks';
import { createSyntheticDropResult, createSyntheticMarketResultForCase } from './desktop-harness-baseline.js';

const profile = createOpenAICompatibleProfile({
  id: 'openai-compatible-contract-mock', label: 'OpenAI-compatible contract mock', model: 'synthetic-contract-model',
  description: 'Synthetic keyless Chat Completions fixture',
  capabilities: { text: true, vision: false, nativeTools: true, structuredOutput: true, reasoning: false, streaming: true, cancellation: true, contextWindow: 16_384 },
  configuration: { configVersion: '1.0', baseUrl: 'http://127.0.0.1:18181/v1', api: 'chat_completions', healthCheck: 'models', credential: { kind: 'none' }, maxOutputTokens: 512 },
});

function sse(payload: Record<string, unknown>): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
function toolPayload(name: string, args: Record<string, unknown>): Response {
  return sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name, arguments: JSON.stringify(args) } }] } }] });
}
async function turnResponse(turn: ModelTurn): Promise<Response> {
  if (turn.kind === 'market_query') return toolPayload('market.query', turn.request as unknown as Record<string, unknown>);
  if (turn.kind === 'drop_search') return toolPayload('drops.search', turn.request as unknown as Record<string, unknown>);
  if (turn.kind === 'clarify') {
    const fact = turn.facts[0];
    return toolPayload('agent.clarify', { text: turn.text, field: String(fact?.value ?? 'unknown'), reason: fact?.key === 'invalid_field' ? 'invalid' : 'missing' });
  }
  return sse({ choices: [{ delta: { content: turn.text } }] });
}
const adapter = createOpenAICompatibleAdapter({
  fetch: async (url, init) => {
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: profile.model }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    // 第二轮起：请求里带有 tool 角色的工具结果，用 agent.conclude 提交终态，
    // 覆盖 Harness 工具结果回送的完整合同路径（工具轮 -> 回送 -> 结构化终态）。
    const toolMessage = body.messages.find((message) => message.role === 'tool');
    if (toolMessage) {
      return toolPayload('agent.conclude', { text: `工具结果已核实：${String(toolMessage.content).slice(0, 200)}`, conclusion: 'answered' });
    }
    const system = body.messages.find((message) => message.role === 'system')?.content ?? '';
    const user = body.messages.find((message) => message.role === 'user')?.content ?? '';
    const rawDefaults = system.match(/调用方提供的显式默认参数：(.*)$/u)?.[1];
    const defaults = rawDefaults ? JSON.parse(rawDefaults) : undefined;
    const turnResult = await localRulesModelAdapter.generateTurn({ message: user, signal: init?.signal ?? new AbortController().signal, ...(defaults ? { defaults } : {}) }, DEFAULT_MODEL_PROFILES[0]!);
    return turnResponse(turnResult.turn);
  },
});

export async function createOpenAICompatibleMockTrace(testCase: AgentEvalCase): Promise<AgentTrace> {
  const syntheticLatencyMs = testCase.expected.decision === 'call_tool' ? 3 : 2;
  let clockCalls = 0;
  const syntheticNow = () => clockCalls++ === 0 ? 0 : syntheticLatencyMs;
  const isDrop = testCase.id.startsWith('drops-');
  const isEvidence = testCase.category === 'evidence';
  const isFailure = testCase.category === 'failure-degradation';
  const run = await runDesktopAgent({
    requestId: testCase.id, message: testCase.prompt, modelProfileId: profile.id, context: testCase.context,
    ...(!isDrop && (isEvidence || isFailure) ? { defaults: { ...MOCK_MARKET_QUERY_REQUEST } } : {}),
  }, {
    profiles: [profile], adapters: [adapter],
    marketQuery: async () => createSyntheticMarketResultForCase(testCase),
    searchDrops: async () => createSyntheticDropResult(testCase),
    now: syntheticNow,
  });
  return run.trace;
}
