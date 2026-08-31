import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ModelAdapterError,
  createOpenAICompatibleAdapter,
  createOpenAICompatibleProfile,
} from '../dist/index.js';

const capabilities = {
  text: true, vision: false, nativeTools: true, structuredOutput: true,
  reasoning: false, streaming: false, cancellation: true, contextWindow: 16_384,
};
function profile(overrides = {}) {
  return createOpenAICompatibleProfile({
    id: 'synthetic-openai-local', label: 'Synthetic local', model: 'synthetic-model',
    description: 'Synthetic contract fixture', capabilities,
    configuration: {
      configVersion: '1.0', baseUrl: 'http://127.0.0.1:11434/v1', api: 'chat_completions',
      healthCheck: 'models', credential: { kind: 'none' }, maxOutputTokens: 512,
    },
    ...overrides,
  });
}
function json(value, init = {}) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}
function sse(blocks) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const block of blocks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(block)}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

test('本机 profile 只保存凭据引用并拒绝内联密钥与非回环 HTTP', () => {
  const valid = profile({ configuration: {
    configVersion: '1.0', baseUrl: 'https://models.synthetic.invalid/v1', api: 'chat_completions',
    healthCheck: 'models', credential: { kind: 'environment', variable: 'SYNTHETIC_MODEL_KEY' }, maxOutputTokens: 256,
  } });
  assert.deepEqual(valid.configuration.credential, { kind: 'environment', variable: 'SYNTHETIC_MODEL_KEY' });
  assert.throws(() => createOpenAICompatibleProfile({
    id: 'bad', label: 'Bad', model: 'bad', capabilities,
    configuration: { configVersion: '1.0', baseUrl: 'https://example.invalid/v1', api: 'chat_completions', healthCheck: 'models', credential: { kind: 'inline', apiKey: 'synthetic-secret' }, maxOutputTokens: 256 },
  }), (error) => error instanceof ModelAdapterError && error.failure.code === 'MODEL_CONFIG_INVALID');
  assert.throws(() => profile({ configuration: {
    configVersion: '1.0', baseUrl: 'http://models.synthetic.invalid/v1', api: 'chat_completions',
    healthCheck: 'models', credential: { kind: 'none' }, maxOutputTokens: 256,
  } }), /HTTPS/u);
});

test('keyless /models 健康检查不发送 Authorization 并报告模型存在', async () => {
  let observed;
  const adapter = createOpenAICompatibleAdapter({ fetch: async (url, init) => {
    observed = { url, init }; return json({ object: 'list', data: [{ id: 'synthetic-model' }] });
  } });
  const health = await adapter.checkHealth(profile());
  assert.equal(health.available, true);
  assert.match(health.summary, /找到所选模型/u);
  assert.equal(observed.url, 'http://127.0.0.1:11434/v1/models');
  assert.equal(observed.init.headers.authorization, undefined);
});

test('环境凭据缺失是稳定配置错误且不会发起请求', async () => {
  let called = false;
  const adapter = createOpenAICompatibleAdapter({
    fetch: async () => { called = true; return json({ data: [] }); },
    resolveCredential: async () => undefined,
  });
  const configured = profile({ configuration: {
    configVersion: '1.0', baseUrl: 'https://models.synthetic.invalid/v1', api: 'chat_completions',
    healthCheck: 'models', credential: { kind: 'environment', variable: 'SYNTHETIC_MODEL_KEY' }, maxOutputTokens: 256,
  } });
  const health = await adapter.checkHealth(configured);
  assert.equal(health.available, false);
  assert.equal(health.error.code, 'MODEL_CREDENTIAL_UNAVAILABLE');
  assert.equal(called, false);
});

test('非流式 Chat Completions 结构化调用 market.query 并解析用量与结束原因', async () => {
  let requestBody;
  const adapter = createOpenAICompatibleAdapter({ fetch: async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return json({
      choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'market_query', arguments: JSON.stringify({ contractVersion: '1.0', item: 'Synthetic Prime', platform: 'pc', crossplay: true, rank: 0 }) } }] }, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
    });
  } });
  const result = await adapter.generateTurn({ message: 'synthetic market query', signal: new AbortController().signal }, profile());
  assert.equal(result.turn.request.item, 'Synthetic Prime');
  assert.deepEqual(result.usage, { promptTokens: 12, completionTokens: 34, totalTokens: 46 });
  assert.equal(result.finishReason, 'tool_calls');
  assert.deepEqual(requestBody.tools.map((tool) => tool.function.name), ['market_query', 'drop_search', 'account_snapshot', 'agent_clarify', 'agent_conclude']);
  assert.equal(requestBody.stream, false);
  assert.equal(requestBody.messages.length, 2);
});

test('SSE 可拼接结构化 drops.search 工具参数', async () => {
  const adapter = createOpenAICompatibleAdapter({ fetch: async () => sse([
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'drop_search', arguments: '{"contractVersion":"1.1",' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"item":"Synthetic Blueprint"}' } }] }, finish_reason: 'tool_calls' }] },
    { choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } },
  ]) });
  const streamingProfile = profile({ capabilities: { ...capabilities, streaming: true } });
  const result = await adapter.generateTurn({ message: 'synthetic drops query', signal: new AbortController().signal }, streamingProfile);
  assert.equal(result.turn.kind, 'drop_search');
  assert.equal(result.turn.request.item, 'Synthetic Blueprint');
  assert.equal(result.finishReason, 'tool_calls');
  assert.deepEqual(result.usage, { promptTokens: 5, completionTokens: 6, totalTokens: 11 });
});

test('SSE 文本按增量回调并返回一致终态', async () => {
  const deltas = [];
  const adapter = createOpenAICompatibleAdapter({ fetch: async () => sse([
    { choices: [{ delta: { content: '请补充' } }] },
    { choices: [{ delta: { content: '平台与等级。' }, finish_reason: 'stop' }] },
  ]) });
  const result = await adapter.generateTurn({
    message: 'synthetic clarification', signal: new AbortController().signal, onTextDelta: (delta) => deltas.push(delta),
  }, profile({ capabilities: { ...capabilities, streaming: true } }));
  assert.deepEqual(deltas, ['请补充', '平台与等级。']);
  assert.deepEqual(result.turn, { kind: 'answer', text: '请补充平台与等级。', streamed: true });
  assert.equal(result.finishReason, 'stop');
});

test('工具轮历史按 assistant tool_calls + tool 角色拼接且不夹带原始结果', async () => {
  let requestBody;
  const adapter = createOpenAICompatibleAdapter({ fetch: async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return json({ choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'agent_conclude', arguments: JSON.stringify({ text: '已核实。', conclusion: 'answered' }) } }] } }] });
  } });
  const result = await adapter.generateTurn({
    message: 'synthetic second pass', signal: new AbortController().signal,
    history: [
      { toolName: 'market.query', toolCall: { contractVersion: '1.0', item: 'Synthetic Prime', platform: 'pc', crossplay: true, rank: 0 }, toolResultSummary: 'market.query 成功：卖单 1 条。', assistantReasoning: 'synthetic chain' },
      { toolName: 'drops.search', toolCall: { contractVersion: '1.1', item: 'Synthetic Blueprint' }, toolResultSummary: 'drops.search 失败：SOURCE_TOO_OLD。' },
    ],
  }, profile());
  assert.equal(result.turn.kind, 'conclude');
  assert.equal(result.turn.conclusion, 'answered');
  assert.deepEqual(requestBody.messages.map((message) => message.role), ['system', 'user', 'assistant', 'tool', 'assistant', 'tool']);
  const firstAssistant = requestBody.messages[2];
  assert.equal(firstAssistant.content, null);
  assert.equal(firstAssistant.reasoning_content, 'synthetic chain');
  assert.equal(firstAssistant.tool_calls[0].id, 'tool_round_0');
  assert.equal(firstAssistant.tool_calls[0].function.name, 'market_query');
  const firstTool = requestBody.messages[3];
  assert.equal(firstTool.tool_call_id, 'tool_round_0');
  assert.match(firstTool.content, /卖单 1 条/u);
  assert.doesNotMatch(JSON.stringify(requestBody.messages), /sellOrders|buyOrders|evidence|rawPayload/u);
});

test('SSE 捕获推理模型 reasoning_content 供回送回传', async () => {  const adapter = createOpenAICompatibleAdapter({ fetch: async () => sse([
    { choices: [{ delta: { role: 'assistant', content: null, reasoning_content: '用户想' } }] },
    { choices: [{ delta: { reasoning_content: '查询市场' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'market_query', arguments: JSON.stringify({ contractVersion: '1.0', item: 'Synthetic Prime', platform: 'pc', crossplay: true, rank: 0 }) } }] }, finish_reason: 'tool_calls' }] },
  ]) });
  const streamingProfile = profile({ capabilities: { ...capabilities, streaming: true } });
  const result = await adapter.generateTurn({ message: 'synthetic', signal: new AbortController().signal }, streamingProfile);
  assert.equal(result.turn.kind, 'market_query');
  assert.equal(result.reasoning, '用户想查询市场');
});

test('account_snapshot 工具调用解析为账号快照路由', async () => {
  const adapter = createOpenAICompatibleAdapter({ fetch: async () => json({
    choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'account_snapshot', arguments: JSON.stringify({ contractVersion: '1.0', item: '古纪V3' }) } }] } }],
  }) });
  const result = await adapter.generateTurn({ message: 'synthetic', signal: new AbortController().signal }, profile());
  assert.equal(result.turn.kind, 'account_snapshot');
  assert.deepEqual(result.turn.request, { contractVersion: '1.0', item: '古纪V3' });
});

test('agent.conclude 终态只接受 answered 与 insufficient_data', async () => {
  const answered = createOpenAICompatibleAdapter({ fetch: async () => json({
    choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'agent_conclude', arguments: JSON.stringify({ text: '根据工具结果作答。', conclusion: 'answered' }) } }] } }],
  }) });
  const good = await answered.generateTurn({ message: 'synthetic', signal: new AbortController().signal, history: [{ toolName: 'market.query', toolCall: {}, toolResultSummary: 'synthetic' }] }, profile());
  assert.deepEqual(good.turn, { kind: 'conclude', text: '根据工具结果作答。', conclusion: 'answered' });

  const bad = createOpenAICompatibleAdapter({ fetch: async () => json({
    choices: [{ message: { role: 'assistant', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'agent_conclude', arguments: JSON.stringify({ text: '我拒绝。', conclusion: 'refused' }) } }] } }],
  }) });
  await assert.rejects(
    bad.generateTurn({ message: 'synthetic', signal: new AbortController().signal, history: [{ toolName: 'market.query', toolCall: {}, toolResultSummary: 'synthetic' }] }, profile()),
    (error) => error instanceof ModelAdapterError && error.failure.code === 'MODEL_BAD_RESPONSE',
  );
});

test('HTTP 与坏响应映射为稳定错误分类', async () => {
  for (const [status, code] of [[401, 'MODEL_AUTH_REJECTED'], [429, 'MODEL_RATE_LIMITED'], [503, 'MODEL_UNAVAILABLE']]) {
    const adapter = createOpenAICompatibleAdapter({ fetch: async () => new Response('', { status, headers: status === 429 ? { 'retry-after': '2' } : {} }) });
    await assert.rejects(
      adapter.generateTurn({ message: 'synthetic', signal: new AbortController().signal }, profile()),
      (error) => error instanceof ModelAdapterError && error.failure.code === code && (status !== 429 || error.failure.retryAfterMs === 2_000),
    );
  }
  const bad = createOpenAICompatibleAdapter({ fetch: async () => json({ choices: [] }) });
  await assert.rejects(
    bad.generateTurn({ message: 'synthetic', signal: new AbortController().signal }, profile()),
    (error) => error instanceof ModelAdapterError && error.failure.code === 'MODEL_BAD_RESPONSE',
  );
});

test('取消信号传入 fetch 并稳定分类为 MODEL_CANCELLED', async () => {
  const controller = new AbortController();
  const adapter = createOpenAICompatibleAdapter({ fetch: async (_url, init) => new Promise((_resolve, reject) => {
    if (init.signal.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }) });
  const pending = adapter.generateTurn({ message: 'synthetic', signal: controller.signal }, profile());
  controller.abort(new Error('cancelled'));
  await assert.rejects(pending, (error) => error instanceof ModelAdapterError && error.failure.code === 'MODEL_CANCELLED');
});
