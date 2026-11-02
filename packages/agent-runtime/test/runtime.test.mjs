import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ModelAdapterError,
  checkModelProfile,
  createOpenAICompatibleAdapter,
  createOpenAICompatibleProfile,
  isNaturalMarketPriceQuery,
  listModelProfiles,
  marketScopeFromMessage,
  normalizeMarketQueryRequest,
  runDesktopAgent,
  scopeChoiceRequired,
} from '../dist/index.js';
import { MOCK_MARKET_QUERY_FAILURES, MOCK_MARKET_QUERY_SUCCESS } from '@warframe-companion/market-query-contract/mocks';

const context = { channel: 'desktop', trustedOwner: true, now: '2030-01-02T03:04:05.000Z' };

function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('查询前缀不会把询字混入市场物品名', async () => {
  let queriedItem;
  await runDesktopAgent({ requestId: 'synthetic-query-prefix', message: '查询示例 Prime 蓝图，PC 跨平台，0级。', context }, {
    marketQuery: async (request) => {
      queriedItem = request.item;
      return structuredClone(MOCK_MARKET_QUERY_SUCCESS);
    },
  });
  assert.equal(queriedItem, '示例 Prime 蓝图');
});

function syntheticDropResult(request) {
  return {
    contractVersion: '1.0', ok: true,
    data: { requestedItem: request.item, resolvedItem: request.item, match: 'exact', totalDrops: 1, drops: [{ place: 'Venus/Aphrodite (Capture)', chance: 8.5, rarity: 'Uncommon' }] },
    evidence: {
      scope: 'static_drop_table', evidenceType: 'versioned_public_snapshot', asOf: '2030-01-01T00:00:00.000Z', loadedAt: '2030-01-02T00:00:00.000Z', expiresAt: '2030-01-03T00:00:00.000Z', freshness: 'fresh', cacheFreshness: 'fresh',
      sourceAge: { ageMs: 97_445_000, status: 'current', warningAfterMs: 2_592_000_000, rejectAfterMs: 7_776_000_000 },
      finding: 'confirmed_present', source: 'wfcd.drop-data', sourceHash: 'synthetic', selectedEndpoint: 'wfcd.jsdelivr',
      alternativeComparison: { checkedAt: '2030-01-02T00:00:00.000Z', status: 'matched', preferred: 'primary', reason: 'same_hash', primaryHash: 'synthetic', alternativeHash: 'synthetic' },
    },
    warnings: [],
  };
}

test('已保存范围偏好：自然问价不再澄清平台/跨平台/等级并默认 0 级', async () => {
  let requested;
  const events = [];
  const result = await runDesktopAgent({ requestId: 'synthetic-scope-configured', message: '母牛p多少钱', context, defaults: { platform: 'pc', crossplay: true } }, {
    marketQuery: async (request) => { requested = request; return structuredClone(MOCK_MARKET_QUERY_SUCCESS); },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.trace.decision, 'call_tool');
  assert.equal(result.trace.toolCalls[0].name, 'market.query');
  assert.deepEqual(requested, { contractVersion: '1.0', item: '母牛p', platform: 'pc', crossplay: true, rank: 0 });
  assert.equal(events.some((event) => event.type === 'scope_choice_required'), false);
});

test('已保存范围偏好：满级/具体等级按消息解析，消息范围优先于偏好', async () => {
  const requested = [];
  for (const message of ['母牛p满级多少钱', '母牛p 3级多少钱', '查询 母牛p 价格，PC 不跨平台，0级。']) {
    await runDesktopAgent({ requestId: `synthetic-scope-rank-${requested.length}`, message, context, defaults: { platform: 'pc', crossplay: true } }, {
      marketQuery: async (request) => {
        requested.push({ item: request.item, platform: request.platform, crossplay: request.crossplay, rank: request.rank });
        return structuredClone(MOCK_MARKET_QUERY_SUCCESS);
      },
    });
  }
  assert.deepEqual(requested, [
    { item: '母牛p', platform: 'pc', crossplay: true, rank: 'max' },
    { item: '母牛p', platform: 'pc', crossplay: true, rank: 3 },
    { item: '母牛p', platform: 'pc', crossplay: false, rank: 0 },
  ]);
});

test('未保存偏好：自然问价只出现一次可点击选择卡且不执行工具', async () => {
  let marketCalled = false;
  const events = [];
  const result = await runDesktopAgent({ requestId: 'synthetic-scope-prompt', message: '母牛p多少钱', context, askScopeIfMissing: true }, {
    marketQuery: async () => { marketCalled = true; return structuredClone(MOCK_MARKET_QUERY_SUCCESS); },
    onEvent: (event) => events.push(event),
  });
  assert.equal(marketCalled, false);
  assert.equal(result.trace.decision, 'clarify');
  assert.equal(result.trace.toolCalls.length, 0);
  const card = events.find((event) => event.type === 'scope_choice_required');
  assert.ok(card);
  assert.equal(card.questionId, 'scope-synthetic-scope-prompt');
  assert.ok(card.options.length > 1);
  assert.equal(card.options[0].id, 'pc-crossplay');
  assert.deepEqual({ platform: card.options[0].platform, crossplay: card.options[0].crossplay }, { platform: 'pc', crossplay: true });
  assert.equal(card.options[0].recommended, true);
  assert.equal(new Set(card.options.map((option) => option.id)).size, card.options.length);
  assert.ok(card.options.every((option) => option.label.length > 0));
  assert.match(result.message, /默认交易范围/u);
});

test('未保存偏好：消息明确给出范围时直接查询，不弹选择卡', async () => {
  let requested;
  const events = [];
  const result = await runDesktopAgent({ requestId: 'synthetic-scope-explicit', message: '查询 母牛p 价格，PS4 跨平台，0级。', context, askScopeIfMissing: true }, {
    marketQuery: async (request) => { requested = request; return structuredClone(MOCK_MARKET_QUERY_SUCCESS); },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.trace.decision, 'call_tool');
  assert.equal(requested.item, '母牛p');
  assert.equal(requested.platform, 'ps4');
  assert.equal(requested.crossplay, true);
  assert.equal(requested.rank, 0);
  assert.equal(events.some((event) => event.type === 'scope_choice_required'), false);
});

test('未保存偏好：无效等级澄清仍走文本追问，不换成选择卡', async () => {
  const events = [];
  const result = await runDesktopAgent({ requestId: 'synthetic-scope-invalid-rank', message: '母牛p负3级多少钱', context, askScopeIfMissing: true }, {
    marketQuery: async () => { throw new Error('market must not be called'); },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.trace.decision, 'clarify');
  assert.equal(events.some((event) => event.type === 'scope_choice_required'), false);
  assert.match(result.message, /等级/u);
});

test('未保存偏好：掉落与个人快照路由不受选择卡影响', async () => {
  let dropped = false;
  let snapshotCalled = false;
  const dropEvents = [];
  await runDesktopAgent({ requestId: 'synthetic-scope-drop', message: 'Example Blueprint 哪里掉落？', context, askScopeIfMissing: true }, {
    marketQuery: async () => { throw new Error('market must not be called'); },
    searchDrops: async (request) => { dropped = true; return syntheticDropResult(request); },
    onEvent: (event) => dropEvents.push(event),
  });
  assert.equal(dropped, true);
  assert.equal(dropEvents.some((event) => event.type === 'scope_choice_required'), false);
  await runDesktopAgent({ requestId: 'synthetic-scope-account', message: '我的库存 古纪V3', context, askScopeIfMissing: true }, {
    marketQuery: async () => { throw new Error('market must not be called'); },
    getSnapshot: async () => {
      snapshotCalled = true;
      return {
        contractVersion: '1.0', ok: true,
        data: { requestedItem: '古纪V3', totals: { masteryRank: 30, platinum: 1234, credits: 567890, ducats: 456 }, items: [{ name: '古纪V3', count: 2 }], snapshotAt: '2030-01-02T03:04:05.000Z' },
        evidence: { scope: 'personal_snapshot', evidenceType: 'local_snapshot', asOf: '2030-01-02T03:04:05.000Z', expiresAt: '2030-01-02T03:09:05.000Z', freshness: 'fresh', finding: 'confirmed_present', source: 'synthetic.local' },
        warnings: [],
      };
    },
  });
  assert.equal(snapshotCalled, true);
});

test('已保存范围偏好不改变掉落与个人快照路由', async () => {
  let dropped = false;
  await runDesktopAgent({ requestId: 'synthetic-scope-drop-defaults', message: 'Example Blueprint 哪里掉落？', context, defaults: { platform: 'pc', crossplay: true } }, {
    marketQuery: async () => { throw new Error('market must not be called'); },
    searchDrops: async (request) => { dropped = true; return syntheticDropResult(request); },
  });
  assert.equal(dropped, true);
});

test('非市场意图（寒暄）不会触发一次选择卡，无论是否已配置范围', async () => {
  for (const run of [{ askScopeIfMissing: true }, { defaults: { platform: 'pc', crossplay: true } }]) {
    const events = [];
    const result = await runDesktopAgent({ requestId: `synthetic-scope-greeting-${events.length}`, message: '你好', context, ...run }, {
      marketQuery: async () => { throw new Error('market must not be called'); },
      onEvent: (event) => events.push(event),
    });
    assert.equal(result.trace.decision, 'answer');
    assert.equal(events.some((event) => event.type === 'scope_choice_required'), false);
    assert.match(result.message, /公开市场查询/u);
  }
});

test('显式 defaults 带物品时视为明确市场查询，即使提示语不含查价词', async () => {
  const defaults = { contractVersion: '1.0', item: '示例 Prime 蓝图', platform: 'pc', crossplay: true, rank: 0 };
  let queried;
  const result = await runDesktopAgent({ requestId: 'synthetic-explicit-defaults-item', message: '根据新鲜快照说明是否有挂单。', context, defaults }, {
    marketQuery: async (request) => { queried = request; return structuredClone(MOCK_MARKET_QUERY_SUCCESS); },
  });
  assert.deepEqual(queried, defaults);
  assert.equal(result.trace.decision, 'call_tool');
  assert.equal(result.trace.toolCalls[0]?.name, 'market.query');
});

test('确定性范围解析：平台/跨平台/等级从消息提取且否定跨平台优先', () => {
  assert.deepEqual(marketScopeFromMessage('查询 母牛p 价格，PS4 不跨平台，3级。'), { platform: 'ps4', crossplay: false, rank: 3 });
  assert.deepEqual(marketScopeFromMessage('查询 母牛p 行情，Xbox 跨平台。'), { platform: 'xbox', crossplay: true });
  assert.deepEqual(marketScopeFromMessage('母牛p满级多少钱'), { rank: 'max' });
  assert.deepEqual(marketScopeFromMessage('母牛p多少钱'), {});
  // 负等级是用户明确给出的非法条件，不能被默认 0 悄悄替换。
  assert.deepEqual(marketScopeFromMessage('母牛p负3级多少钱'), { rank: null });
  assert.deepEqual(marketScopeFromMessage('查询 母牛p 价格，PC 跨平台，0级。'), { platform: 'pc', crossplay: true, rank: 0 });
});

test('模型无关的问价意图判定排除掉落/个人/寒暄/写操作', () => {
  assert.equal(isNaturalMarketPriceQuery('母牛p多少钱'), true);
  assert.equal(isNaturalMarketPriceQuery('查一下 母牛p 当前行情'), true);
  assert.equal(isNaturalMarketPriceQuery('查询 母牛p 价格，PC 跨平台，0级。'), true);
  assert.equal(isNaturalMarketPriceQuery('你好'), false);
  assert.equal(isNaturalMarketPriceQuery('Example Blueprint 哪里掉落？'), false);
  assert.equal(isNaturalMarketPriceQuery('查询 Example Blueprint 掉落来源'), false);
  assert.equal(isNaturalMarketPriceQuery('我的库存 古纪V3'), false);
  assert.equal(isNaturalMarketPriceQuery('替我在市场挂一个卖单。'), false);
  assert.equal(isNaturalMarketPriceQuery('今晚干什么'), false);
});

test('选择卡预检只在未配置默认范围且自然市场问价缺平台/跨平台时要求', () => {
  assert.equal(scopeChoiceRequired('母牛p多少钱', undefined, true), true);
  assert.equal(scopeChoiceRequired('母牛p多少钱 不跨平台', undefined, true), true);
  assert.equal(scopeChoiceRequired('母牛p多少钱 PC 跨平台', undefined, true), false);
  assert.equal(scopeChoiceRequired('母牛p多少钱', { platform: 'pc', crossplay: true }, true), false);
  assert.equal(scopeChoiceRequired('母牛p多少钱', { platform: 'pc' }, true), true);
  assert.equal(scopeChoiceRequired('母牛p多少钱', undefined, false), false);
  assert.equal(scopeChoiceRequired('你好', undefined, true), false);
  assert.equal(scopeChoiceRequired('母牛p多少钱 哪里掉落', undefined, true), false);
  assert.equal(scopeChoiceRequired('母牛p负3级多少钱', undefined, true), false);
});

test('选择卡诊断保留显式 false，只报告真正缺少的平台', async () => {
  const adapter = {
    id: 'synthetic-missing-platform', adapterVersion: 1,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn() { throw new Error('model must not be called'); },
  };
  const profile = roundTripProfile('synthetic-missing-platform', adapter);
  const result = await runDesktopAgent({ requestId: 'synthetic-missing-platform', message: '母牛p多少钱 不跨平台', modelProfileId: profile.id, context, askScopeIfMissing: true }, {
    marketQuery: async () => { throw new Error('market must not be called'); },
    profiles: [profile], adapters: [adapter],
  });
  assert.deepEqual(result.trace.facts, [{ key: 'missing_field', value: 'platform' }]);
});

test('归一化优先级：消息明确条件 > defaults > 模型范围；缺省等级 0', () => {
  const modelScope = { contractVersion: '1.0', item: '母牛p', platform: 'xbox', crossplay: false, rank: 5 };
  assert.deepEqual(normalizeMarketQueryRequest(modelScope, '查询 母牛p 价格，PC 跨平台，3级。', { platform: 'ps4', crossplay: true }),
    { contractVersion: '1.0', item: '母牛p', platform: 'pc', crossplay: true, rank: 3 });
  assert.deepEqual(normalizeMarketQueryRequest(modelScope, '母牛p多少钱', { platform: 'pc', crossplay: true }),
    { contractVersion: '1.0', item: '母牛p', platform: 'pc', crossplay: true, rank: 0 });
  assert.deepEqual(normalizeMarketQueryRequest(modelScope, '母牛p多少钱', undefined),
    { contractVersion: '1.0', item: '母牛p', platform: 'xbox', crossplay: false, rank: 0 });
  assert.deepEqual(normalizeMarketQueryRequest(modelScope, '母牛p满级多少钱', { platform: 'pc', crossplay: false }),
    { contractVersion: '1.0', item: '母牛p', platform: 'pc', crossplay: false, rank: 'max' });
});

test('未保存偏好：返回普通文本的 adapter 也无法绕过一次选择卡，模型不被调用', async () => {
  let generateCalls = 0;
  const events = [];
  const adapter = {
    id: 'synthetic-plain-answer', adapterVersion: 1,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn() {
      generateCalls += 1;
      return { turn: { kind: 'answer', text: '请先告诉我平台和跨平台范围。' } };
    },
  };
  const profile = roundTripProfile('synthetic-plain-answer', adapter);
  const result = await runDesktopAgent({ requestId: 'synthetic-plain-answer', message: '母牛p多少钱', modelProfileId: profile.id, context, askScopeIfMissing: true }, {
    marketQuery: async () => { throw new Error('market must not be called'); },
    profiles: [profile], adapters: [adapter], onEvent: (event) => events.push(event),
  });
  assert.equal(generateCalls, 0);
  assert.equal(result.trace.decision, 'clarify');
  assert.equal(result.trace.toolCalls.length, 0);
  const card = events.find((event) => event.type === 'scope_choice_required');
  assert.ok(card);
  assert.equal(card.questionId, 'scope-synthetic-plain-answer');
  assert.equal(card.prompt, '先选择默认交易范围（推荐 PC 跨平台）。选择后会继续这次查询，并作为之后的默认值。');
});

test('OpenAI-compatible 返回普通文本时选择卡仍在模型请求前发出', async () => {
  const fetches = [];
  const openAiAdapter = createOpenAICompatibleAdapter({ fetch: async (url) => {
    fetches.push(String(url));
    if (String(url).endsWith('/models')) return jsonResponse({ object: 'list', data: [{ id: 'synthetic-model' }] });
    return jsonResponse({ choices: [{ message: { role: 'assistant', content: '请先提供平台与跨平台范围。' }, finish_reason: 'stop' }] });
  } });
  const profile = createOpenAICompatibleProfile({
    id: 'synthetic-openai-plain', label: 'Synthetic plain', model: 'synthetic-model',
    capabilities: { text: true, vision: false, nativeTools: true, structuredOutput: true, reasoning: false, streaming: false, cancellation: true, contextWindow: 16_384 },
    configuration: {
      configVersion: '1.0', baseUrl: 'http://127.0.0.1:11434/v1', api: 'chat_completions',
      healthCheck: 'models', credential: { kind: 'none' }, maxOutputTokens: 512,
    },
  });
  const events = [];
  const result = await runDesktopAgent({ requestId: 'synthetic-openai-plain', message: '母牛p多少钱', modelProfileId: profile.id, context, askScopeIfMissing: true }, {
    marketQuery: async () => { throw new Error('market must not be called'); },
    profiles: [profile], adapters: [openAiAdapter], onEvent: (event) => events.push(event),
  });
  // 只有 /models 健康检查，未发起任何 chat/completions 生成请求。
  assert.equal(fetches.length, 1);
  assert.match(fetches[0], /\/models$/u);
  assert.equal(result.trace.decision, 'clarify');
  assert.equal(result.trace.toolCalls.length, 0);
  assert.equal(events.some((event) => event.type === 'scope_choice_required'), true);
  assert.equal(events.some((event) => event.type === 'tool_call'), false);
});

test('adapter 返回错误市场范围也不能覆盖消息明确条件或已保存偏好', async () => {
  for (const scenario of [
    { message: '查询 母牛p 价格，PC 跨平台，3级。', defaults: { platform: 'ps4', crossplay: true }, expected: { contractVersion: '1.0', item: '母牛p', platform: 'pc', crossplay: true, rank: 3 } },
    { message: '母牛p多少钱', defaults: { platform: 'pc', crossplay: true }, expected: { contractVersion: '1.0', item: '母牛p', platform: 'pc', crossplay: true, rank: 0 } },
  ]) {
    const events = [];
    const adapter = {
      id: 'synthetic-wrong-scope', adapterVersion: 1,
      async checkHealth() { return { available: true, summary: 'synthetic' }; },
      async generateTurn() {
        return { turn: { kind: 'market_query', request: { contractVersion: '1.0', item: '母牛p', platform: 'xbox', crossplay: false, rank: 5 } } };
      },
    };
    const profile = roundTripProfile('synthetic-wrong-scope', adapter);
    const requested = [];
    const result = await runDesktopAgent({ requestId: `synthetic-wrong-scope-${requested.length}`, message: scenario.message, modelProfileId: profile.id, context, defaults: scenario.defaults }, {
      marketQuery: async (request) => { requested.push({ ...request }); return structuredClone(MOCK_MARKET_QUERY_SUCCESS); },
      profiles: [profile], adapters: [adapter], onEvent: (event) => events.push(event),
    });
    assert.deepEqual(requested, [scenario.expected]);
    const emitted = events.find((event) => event.type === 'tool_call');
    assert.ok(emitted);
    assert.deepEqual(emitted.arguments, scenario.expected);
    assert.deepEqual(result.trace.toolCalls[0].arguments, scenario.expected);
    assert.equal(result.trace.decision, 'call_tool');
    assert.equal(events.some((event) => event.type === 'scope_choice_required'), false);
  }
});

test('回送轮：后续轮次模型返回的错误范围同样被程序归一化', async () => {
  const executed = [];
  let modelCalls = 0;
  const adapter = {
    id: 'synthetic-wrong-scope-rounds', adapterVersion: 1, supportsToolRoundTrip: true,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn() {
      modelCalls += 1;
      if (modelCalls >= 3) return { turn: { kind: 'answer', text: '两轮错误范围都被归一回正。' } };
      return { turn: { kind: 'market_query', request: { contractVersion: '1.0', item: '母牛p', platform: 'xbox', crossplay: false, rank: 5 } } };
    },
  };
  const profile = roundTripProfile('synthetic-wrong-scope-rounds', adapter);
  const result = await runDesktopAgent({ requestId: 'synthetic-wrong-scope-rounds', message: '查询 母牛p 价格，PC 跨平台。', modelProfileId: profile.id, context }, {
    marketQuery: async (request) => { executed.push({ ...request }); return structuredClone(MOCK_MARKET_QUERY_SUCCESS); },
    profiles: [profile], adapters: [adapter],
  });
  assert.equal(executed.length, 2);
  for (const request of executed) {
    assert.deepEqual(request, { contractVersion: '1.0', item: '母牛p', platform: 'pc', crossplay: true, rank: 0 });
  }
  assert.deepEqual(result.trace.toolCalls.map((call) => call.arguments), executed);
});

test('用户明确非法等级时 adapter 的 market_query 也被程序拒绝且不执行工具', async () => {
  let called = false;
  const events = [];
  const adapter = {
    id: 'synthetic-invalid-rank', adapterVersion: 1,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn() {
      return { turn: { kind: 'market_query', request: { contractVersion: '1.0', item: '母牛p', platform: 'pc', crossplay: true, rank: 0 } } };
    },
  };
  const profile = roundTripProfile('synthetic-invalid-rank', adapter);
  const result = await runDesktopAgent({ requestId: 'synthetic-invalid-rank', message: '母牛p负3级多少钱', modelProfileId: profile.id, context, askScopeIfMissing: true }, {
    marketQuery: async () => { called = true; return structuredClone(MOCK_MARKET_QUERY_SUCCESS); },
    profiles: [profile], adapters: [adapter], onEvent: (event) => events.push(event),
  });
  assert.equal(called, false);
  assert.equal(result.trace.decision, 'clarify');
  assert.equal(result.trace.toolCalls.length, 0);
  assert.match(result.message, /等级/u);
  assert.equal(events.some((event) => event.type === 'scope_choice_required'), false);
  assert.equal(events.some((event) => event.type === 'tool_call'), false);
});

test('物品歧义时回答列出具体候选，不静默选择', async () => {
  const events = [];
  const result = await runDesktopAgent({ requestId: 'synthetic-ambiguous', message: '查一下示例 Prime 蓝图当前行情，PC 跨平台，0级。', context }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_FAILURES.ambiguous),
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.trace.decision, 'call_tool');
  assert.match(result.message, /候选中选择/u);
  assert.match(result.message, /示例 Prime 套装/u);
  assert.match(result.message, /示例 Prime 蓝图/u);
  assert.ok(events.some((event) => event.type === 'tool_result' && event.ok === false));
});
const ROUND_TRIP_CAPABILITIES = { text: true, vision: false, nativeTools: true, structuredOutput: true, reasoning: false, streaming: false, cancellation: true, contextWindow: 1024 };
function roundTripProfile(id, adapter) {
  return { id, label: `Synthetic ${id}`, adapterId: adapter.id, model: 'synthetic', description: 'synthetic', capabilities: { ...ROUND_TRIP_CAPABILITIES } };
}
function marketTurn() {
  return { kind: 'market_query', request: { contractVersion: '1.0', item: 'Synthetic Prime', platform: 'pc', crossplay: true, rank: 0 } };
}

test('桌面 Harness 执行市场工具并流式导出同一轨迹', async () => {
  const events = [];
  const result = await runDesktopAgent({ requestId: 'synthetic-run', message: '查一下示例 Prime 蓝图当前行情，PC 跨平台，0级。', context }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS), onEvent: (event) => events.push(event), now: () => 100,
  });
  assert.equal(result.trace.decision, 'call_tool');
  assert.equal(result.trace.toolCalls[0].name, 'market.query');
  assert.equal(result.trace.conclusion, 'answered');
  assert.equal(result.trace.conclusionSource, 'harness');
  // 生产路径（不注入任何 evaluation 开关）也必须派生规范事实投影：生产与评估同构。
  assert.ok(result.trace.facts.some((fact) => fact.key === 'market.sell_orders' && fact.value === 'present'));
  assert.ok(result.trace.facts.some((fact) => fact.key === 'market.buy_orders' && fact.value === 'present'));
  assert.ok(result.trace.facts.some((fact) => fact.key === 'market.snapshot_scope' && fact.value === 'current_market'));
  assert.ok(result.trace.facts.some((fact) => fact.key === 'market.history_basis' && fact.value === 'closed_trades_90_days'));
  assert.ok(result.trace.facts.some((fact) => fact.key === 'statistics.available' && fact.value === true));
  assert.ok(events.some((event) => event.type === 'tool_call'));
  assert.ok(events.some((event) => event.type === 'message_delta'));
  assert.ok(events.some((event) => event.type === 'model_conclusion' && event.conclusion === 'answered' && event.source === 'harness'));
  assert.equal(events.at(-1).type, 'completed');
});

test('Warframe 掉落问题路由到本地公共数据工具并保留版本证据', async () => {
  const events = [];
  let queriedItem;
  const result = await runDesktopAgent({ requestId: 'synthetic-drops', message: 'Example Blueprint 哪里掉落？', context }, {
    marketQuery: async () => { throw new Error('market must not be called'); },
    searchDrops: async (request) => {
      queriedItem = request.item;
      return ({
      contractVersion: '1.0', ok: true,
      data: { requestedItem: request.item, resolvedItem: 'Example Blueprint', match: 'exact', totalDrops: 1, drops: [{ place: 'Venus/Aphrodite (Capture)', chance: 8.5, rarity: 'Uncommon' }] },
      evidence: {
        scope: 'static_drop_table', evidenceType: 'versioned_public_snapshot', asOf: '2030-01-01T00:00:00.000Z', loadedAt: '2030-01-02T00:00:00.000Z', expiresAt: '2030-01-03T00:00:00.000Z', freshness: 'fresh', cacheFreshness: 'fresh',
        sourceAge: { ageMs: 97_445_000, status: 'current', warningAfterMs: 2_592_000_000, rejectAfterMs: 7_776_000_000 },
        finding: 'confirmed_present', source: 'wfcd.drop-data', sourceHash: 'synthetic', selectedEndpoint: 'wfcd.jsdelivr',
        alternativeComparison: { checkedAt: '2030-01-02T00:00:00.000Z', status: 'matched', preferred: 'primary', reason: 'same_hash', primaryHash: 'synthetic', alternativeHash: 'synthetic' },
      },
      warnings: [],
      });
    },
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.trace.decision, 'call_tool');
  assert.equal(queriedItem, 'Example Blueprint');
  assert.equal(result.trace.toolCalls[0].name, 'drops.search');
  assert.deepEqual(result.trace.facts.map((fact) => fact.key), ['drops.source_count', 'drops.cache_freshness', 'drops.source_age_status', 'drops.alternative_status']);
  assert.match(result.message, /WFCD drop-data/u);
  assert.ok(events.some((event) => event.type === 'tool_call' && event.name === 'drops.search'));
});

test('禁止写操作在调用工具前拒绝', async () => {
  let called = false;
  const result = await runDesktopAgent({ requestId: 'synthetic-refusal', message: '替我在市场挂一个卖单。', context }, {
    marketQuery: async () => { called = true; return structuredClone(MOCK_MARKET_QUERY_SUCCESS); },
  });
  assert.equal(result.trace.decision, 'refuse');
  assert.equal(result.trace.refusalReason, 'write_forbidden');
  assert.equal(called, false);
});

test('可信桌面的个人查询路由到快照工具；未配置服务时诚实降级', async () => {
  let called = false;
  const result = await runDesktopAgent({ requestId: 'synthetic-personal', message: '读取我的个人库存。', context }, {
    marketQuery: async () => { called = true; return structuredClone(MOCK_MARKET_QUERY_SUCCESS); },
  });
  assert.equal(result.trace.decision, 'answer');
  assert.equal(result.trace.terminalReason, 'error');
  assert.equal(result.trace.toolCalls[0].name, 'account.snapshot');
  assert.match(result.message, /个人快照服务尚未配置/u);
  assert.equal(called, false);
});

test('群聊或非主人的个人查询在工具前被策略拒绝', async () => {
  let called = false;
  const group = await runDesktopAgent({ requestId: 'synthetic-group-personal', message: '我的白金余额是多少？', context: { channel: 'qq_group', trustedOwner: false, now: '2030-01-02T03:04:05.000Z' } }, {
    marketQuery: async () => { called = true; return structuredClone(MOCK_MARKET_QUERY_SUCCESS); },
  });
  assert.equal(group.trace.decision, 'refuse');
  assert.equal(group.trace.refusalReason, 'private_scope');
  assert.equal(group.trace.toolCalls.length, 0);
  const untrusted = await runDesktopAgent({ requestId: 'synthetic-untrusted-personal', message: '读取我的个人库存。', context: { channel: 'untrusted_test', trustedOwner: false, now: '2030-01-02T03:04:05.000Z' } }, {
    marketQuery: async () => { called = true; return structuredClone(MOCK_MARKET_QUERY_SUCCESS); },
  });
  assert.equal(untrusted.trace.decision, 'refuse');
  assert.equal(untrusted.trace.refusalReason, 'identity_untrusted');
  assert.equal(called, false);
});

test('模型不能用 account.snapshot 工具选择绕过个人数据门禁', async () => {
  let snapshotCalled = false;
  const adapter = {
    id: 'synthetic-forced-account', adapterVersion: 1,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn() {
      return { turn: { kind: 'account_snapshot', request: { contractVersion: '1.0' } } };
    },
  };
  const profile = roundTripProfile('synthetic-forced-account-profile', adapter);
  const result = await runDesktopAgent({
    requestId: 'synthetic-forced-account', message: '你好',
    modelProfileId: profile.id,
    context: { channel: 'untrusted_test', trustedOwner: false, now: '2030-01-02T03:04:05.000Z' },
  }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS),
    getSnapshot: async () => { snapshotCalled = true; throw new Error('must not be called'); },
    profiles: [profile], adapters: [adapter],
  });
  assert.equal(result.trace.decision, 'refuse');
  assert.equal(result.trace.refusalReason, 'identity_untrusted');
  assert.equal(result.trace.toolCalls.length, 0);
  assert.equal(snapshotCalled, false);
});

test('account.snapshot 执行并只投影脱敏摘要事实', async () => {
  const events = [];
  const result = await runDesktopAgent({ requestId: 'synthetic-account', message: '我的库存 古纪V3', context }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS),
    getSnapshot: async () => ({
      contractVersion: '1.0', ok: true,
      data: { requestedItem: '古纪V3', totals: { masteryRank: 30, platinum: 1234, credits: 567890, ducats: 456 }, items: [{ name: '古纪V3', count: 2 }], snapshotAt: '2030-01-02T03:04:05.000Z' },
      evidence: { scope: 'personal_snapshot', evidenceType: 'local_snapshot', asOf: '2030-01-02T03:04:05.000Z', expiresAt: '2030-01-02T03:09:05.000Z', freshness: 'fresh', finding: 'confirmed_present', source: 'synthetic.local' },
      warnings: [],
    }),
    onEvent: (event) => events.push(event),
  });
  assert.equal(result.trace.decision, 'call_tool');
  assert.equal(result.trace.toolCalls[0].name, 'account.snapshot');
  assert.deepEqual(result.trace.toolCalls[0].arguments, { contractVersion: '1.0', item: '古纪V3' });
  const factMap = new Map(result.trace.facts.map((fact) => [fact.key, fact.value]));
  assert.equal(factMap.get('personal.snapshot_scope'), 'personal_snapshot');
  assert.equal(factMap.get('personal.matched'), 1);
  assert.equal(factMap.get('personal.item.古纪v3'), 2);
  assert.equal(factMap.get('personal.platinum'), 1234);
  assert.match(result.message, /个人账号快照/u);
  assert.match(result.message, /古纪V3×2/u);
  assert.ok(events.some((event) => event.type === 'tool_call' && event.name === 'account.snapshot'));
});

test('account.snapshot 数据源不可用时诚实降级', async () => {
  const result = await runDesktopAgent({ requestId: 'synthetic-account-failure', message: '账号状态', context }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS),
    getSnapshot: async () => ({
      contractVersion: '1.0', ok: false,
      error: { code: 'SNAPSHOT_UNAVAILABLE', message: '本机账号快照暂时不可用。', retryable: true },
      evidence: { scope: 'personal_snapshot', evidenceType: 'local_snapshot', asOf: '2030-01-02T03:04:05.000Z', expiresAt: '2030-01-02T03:09:05.000Z', freshness: 'fresh', finding: 'unavailable', source: 'synthetic.local' },
    }),
  });
  assert.equal(result.trace.decision, 'call_tool');
  const factMap = new Map(result.trace.facts.map((fact) => [fact.key, fact.value]));
  assert.equal(factMap.get('personal.availability'), 'unavailable');
  assert.equal(factMap.get('error.code'), 'SNAPSHOT_UNAVAILABLE');
  assert.match(result.message, /快照暂时不可用/u);
});

test('模型 profile 可枚举并经过能力与健康门禁', async () => {
  const profiles = listModelProfiles();
  assert.equal(profiles.length, 2);
  assert.equal(profiles.every((profile) => profile.capabilities.text && profile.capabilities.nativeTools), true);
  assert.equal(profiles.every((profile) => profile.capabilities.vision === false), true);
  const health = await checkModelProfile(profiles[1].id);
  assert.equal(health.status, 'healthy');
  assert.match(health.summary, /不会读取密钥/u);
});

test('取消信号终止模型阶段并留下可解释终态', async () => {
  const controller = new AbortController();
  const adapter = {
    id: 'synthetic-pending', adapterVersion: 1,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn({ signal }) {
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
  };
  const profile = {
    id: 'synthetic-pending', label: 'Synthetic', adapterId: adapter.id, model: 'synthetic', description: 'synthetic',
    capabilities: { text: true, vision: false, nativeTools: true, structuredOutput: true, reasoning: false, streaming: false, cancellation: true, contextWindow: 1024 },
  };
  const promise = runDesktopAgent({ requestId: 'synthetic-cancel', message: '查价格', modelProfileId: profile.id, context }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS), signal: controller.signal, profiles: [profile], adapters: [adapter],
  });
  controller.abort(new Error('cancelled'));
  const result = await promise;
  assert.equal(result.trace.terminalReason, 'cancelled');
  assert.match(result.message, /已停止/u);
  assert.equal(result.trace.toolCalls.length, 0);
});

test('模型适配器稳定错误进入事件与轨迹而不被误报为取消', async () => {
  const events = [];
  const adapter = {
    id: 'synthetic-error', adapterVersion: 1,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn() {
      throw new ModelAdapterError({ code: 'MODEL_AUTH_REJECTED', category: 'authentication', message: '合成凭据被拒绝。', retryable: false });
    },
  };
  const profile = {
    id: 'synthetic-error', label: 'Synthetic', adapterId: adapter.id, model: 'synthetic', description: 'synthetic',
    capabilities: { text: true, vision: false, nativeTools: true, structuredOutput: true, reasoning: false, streaming: false, cancellation: true, contextWindow: 1024 },
  };
  const result = await runDesktopAgent({ requestId: 'synthetic-error', message: '查行情', modelProfileId: profile.id, context }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS), profiles: [profile], adapters: [adapter], onEvent: (event) => events.push(event),
  });
  assert.equal(result.trace.terminalReason, 'error');
  assert.deepEqual(result.trace.facts.map((fact) => [fact.key, fact.value]), [['model.error_code', 'MODEL_AUTH_REJECTED'], ['model.error_retryable', false]]);
  assert.ok(events.some((event) => event.type === 'model_error' && event.error.code === 'MODEL_AUTH_REJECTED'));
});

test('回送轮：模型基于工具结果给出最终回答，终态记录模型来源', async () => {
  const events = [];
  let seenHistory;
  const adapter = {
    id: 'synthetic-round-trip', adapterVersion: 1, supportsToolRoundTrip: true,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn(input) {
      if (input.history) {
        seenHistory = input.history;
        return { turn: { kind: 'answer', text: '根据工具结果：示例 Prime 当前有两笔卖单。' }, usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 }, finishReason: 'stop' };
      }
      return { turn: marketTurn(), usage: { promptTokens: 10, completionTokens: 8, totalTokens: 18 }, finishReason: 'tool_calls', reasoning: 'synthetic reasoning chain' };
    },
  };
  const profile = roundTripProfile('synthetic-round-trip', adapter);
  const result = await runDesktopAgent({ requestId: 'synthetic-round-trip', message: '查一下示例 Prime 当前行情。', modelProfileId: profile.id, context }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS), profiles: [profile], adapters: [adapter], onEvent: (event) => events.push(event),
  });
  assert.equal(result.trace.decision, 'call_tool');
  assert.equal(result.trace.conclusion, 'answered');
  assert.equal(result.trace.conclusionSource, 'model');
  assert.match(result.message, /根据工具结果/u);
  assert.ok(result.trace.facts.some((fact) => fact.key === 'market.sell_orders'));
  // adapter 版本与用量/结束原因记入轨迹（两轮汇总）。
  assert.equal(result.trace.adapterVersion, 1);
  assert.equal(result.trace.usage.totalTokens, 43);
  assert.equal(result.trace.usage.promptTokens, 30);
  assert.equal(result.trace.finishReason, 'stop');
  // 思维链作为不透明数据随工具轮回送（供 DeepSeek 思考模式回传），不进轨迹。
  assert.equal(seenHistory[0].assistantReasoning, 'synthetic reasoning chain');
  assert.equal(result.trace.reasoning, undefined);
  assert.ok(events.some((event) => event.type === 'model_conclusion' && event.source === 'model'));
});

test('回送轮：agent.conclude insufficient_data 在工具失败时采用确定性文案', async () => {
  const adapter = {
    id: 'synthetic-insufficient', adapterVersion: 1, supportsToolRoundTrip: true,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn(input) {
      return input.history
        ? { turn: { kind: 'conclude', text: '工具数据不足，无法回答。', conclusion: 'insufficient_data' } }
        : { turn: marketTurn() };
    },
  };
  const profile = roundTripProfile('synthetic-insufficient', adapter);
  const result = await runDesktopAgent({ requestId: 'synthetic-insufficient', message: '查一下示例 Prime 当前行情。', modelProfileId: profile.id, context }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_FAILURES.unavailable), profiles: [profile], adapters: [adapter],
  });
  assert.equal(result.trace.decision, 'call_tool');
  assert.equal(result.trace.conclusion, 'insufficient_data');
  assert.equal(result.trace.conclusionSource, 'model');
  assert.match(result.message, /市场数据源暂时不可用/u);
});

test('回送轮：模型可连续调用多个工具，每轮结果都回送并受上限约束', async () => {
  const calls = [];
  const adapter = {
    id: 'synthetic-multi-tool', adapterVersion: 1, supportsToolRoundTrip: true,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn(input) {
      calls.push(input.history?.length ?? 0);
      if (!input.history) return { turn: marketTurn() };
      if (input.history.length === 1) return { turn: { kind: 'drop_search', request: { contractVersion: '1.1', item: 'Example Blueprint' } } };
      return { turn: { kind: 'answer', text: '两个工具都查完了。' } };
    },
  };
  const profile = roundTripProfile('synthetic-multi-tool', adapter);
  const result = await runDesktopAgent({ requestId: 'synthetic-multi-tool', message: '查一下示例 Prime 行情和掉落。', modelProfileId: profile.id, context }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS),
    searchDrops: async (request) => ({
      contractVersion: '1.0', ok: true,
      data: { requestedItem: request.item, resolvedItem: request.item, match: 'exact', totalDrops: 1, drops: [{ place: 'Venus/Aphrodite (Capture)', chance: 8.5, rarity: 'Uncommon' }] },
      evidence: {
        scope: 'static_drop_table', evidenceType: 'versioned_public_snapshot', asOf: '2030-01-01T00:00:00.000Z', loadedAt: '2030-01-02T00:00:00.000Z', expiresAt: '2030-01-03T00:00:00.000Z', freshness: 'fresh', cacheFreshness: 'fresh',
        sourceAge: { ageMs: 97_445_000, status: 'current', warningAfterMs: 2_592_000_000, rejectAfterMs: 7_776_000_000 },
        finding: 'confirmed_present', source: 'wfcd.drop-data', sourceHash: 'synthetic', selectedEndpoint: 'wfcd.jsdelivr',
        alternativeComparison: { checkedAt: '2030-01-02T00:00:00.000Z', status: 'matched', preferred: 'primary', reason: 'same_hash', primaryHash: 'synthetic', alternativeHash: 'synthetic' },
      },
      warnings: [],
    }),
    profiles: [profile], adapters: [adapter],
  });
  assert.deepEqual(calls, [0, 1, 2]);
  assert.deepEqual(result.trace.toolCalls.map((call) => call.name), ['market.query', 'drops.search']);
  assert.equal(result.trace.conclusionSource, 'model');
});

test('回送轮：模型反复调用工具时在 15 轮上限后由 Harness 确定性收尾', async () => {
  let marketCalls = 0;
  const adapter = {
    id: 'synthetic-loop', adapterVersion: 1, supportsToolRoundTrip: true,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn() { return { turn: marketTurn() }; },
  };
  const profile = roundTripProfile('synthetic-loop', adapter);
  const result = await runDesktopAgent({ requestId: 'synthetic-loop', message: '查行情。', modelProfileId: profile.id, context }, {
    marketQuery: async () => { marketCalls += 1; return structuredClone(MOCK_MARKET_QUERY_SUCCESS); }, profiles: [profile], adapters: [adapter],
  });
  assert.equal(marketCalls, 15);
  assert.equal(result.trace.toolCalls.length, 15);
  assert.equal(result.trace.conclusion, 'answered');
  assert.equal(result.trace.conclusionSource, 'harness');
  assert.equal(result.trace.terminalReason, 'completed');
});

test('回送轮：第二轮模型故障降级为确定性回答并记录稳定错误', async () => {
  const events = [];
  const adapter = {
    id: 'synthetic-second-failure', adapterVersion: 1, supportsToolRoundTrip: true,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn(input) {
      if (input.history) throw new ModelAdapterError({ code: 'MODEL_UNAVAILABLE', category: 'upstream', message: '模型服务当前不可用。', retryable: true });
      return { turn: marketTurn() };
    },
  };
  const profile = roundTripProfile('synthetic-second-failure', adapter);
  const result = await runDesktopAgent({ requestId: 'synthetic-second-failure', message: '查行情。', modelProfileId: profile.id, context }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS), profiles: [profile], adapters: [adapter], onEvent: (event) => events.push(event),
  });
  assert.equal(result.trace.terminalReason, 'completed');
  assert.equal(result.trace.conclusionSource, 'harness');
  assert.equal(result.trace.modelFailure.code, 'MODEL_UNAVAILABLE');
  assert.ok(result.trace.facts.some((fact) => fact.key === 'market.sell_orders'));
  assert.ok(events.some((event) => event.type === 'model_error' && event.error.code === 'MODEL_UNAVAILABLE'));
});

test('回送轮：工具后模型提交 clarify 或终态滥用时回落确定性回答', async () => {
  for (const second of [{ kind: 'clarify', text: '请补充平台。', facts: [{ key: 'missing_field', value: 'platform' }] }, { kind: 'conclude', text: '我拒绝回答。', conclusion: 'insufficient_data' }]) {
    const adapter = {
      id: 'synthetic-fallback', adapterVersion: 1, supportsToolRoundTrip: true,
      async checkHealth() { return { available: true, summary: 'synthetic' }; },
      async generateTurn(input) { return input.history ? { turn: second } : { turn: marketTurn() }; },
    };
    const profile = roundTripProfile('synthetic-fallback', adapter);
    const result = await runDesktopAgent({ requestId: 'synthetic-fallback', message: '查行情。', modelProfileId: profile.id, context }, {
      marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS), profiles: [profile], adapters: [adapter],
    });
    assert.equal(result.trace.decision, 'call_tool');
    assert.equal(result.trace.conclusionSource, 'harness');
    assert.equal(result.trace.terminalReason, 'completed');
    assert.match(result.message, /示例 Prime/u);
  }
});

test('回送轮：第二轮模型阶段取消或超时仍然终止本轮', async () => {
  const controller = new AbortController();
  const adapter = {
    id: 'synthetic-second-cancel', adapterVersion: 1, supportsToolRoundTrip: true,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn(input) {
      if (!input.history) return { turn: marketTurn() };
      return new Promise((_resolve, reject) => input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true }));
    },
  };
  const profile = roundTripProfile('synthetic-second-cancel', adapter);
  const promise = runDesktopAgent({ requestId: 'synthetic-second-cancel', message: '查行情。', modelProfileId: profile.id, context }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS), profiles: [profile], adapters: [adapter], signal: controller.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  controller.abort(new Error('cancelled'));
  const result = await promise;
  assert.equal(result.trace.terminalReason, 'cancelled');
  assert.equal(result.trace.toolCalls.length, 1);
});

// ---- D2a1 循环预算和停止 ----

test('D2a1：第 15 次观察后进入一次受限最终汇总，且无第 16 次业务执行', async () => {
  let marketCalls = 0;
  const modes = [];
  const adapter = {
    id: 'synthetic-finalize-ok', adapterVersion: 2, supportsToolRoundTrip: true,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn(input) {
      modes.push(input.mode ?? 'decide');
      if (input.mode === 'finalize') return { turn: { kind: 'answer', text: '最终汇总：基于第 15 次工具结果作答。' } };
      return { turn: marketTurn() };
    },
  };
  const profile = roundTripProfile('synthetic-finalize-ok', adapter);
  const events = [];
  const result = await runDesktopAgent({ requestId: 'd2a1-finalize-ok', message: '查行情。', modelProfileId: profile.id, context }, {
    marketQuery: async () => { marketCalls += 1; return structuredClone(MOCK_MARKET_QUERY_SUCCESS); },
    profiles: [profile], adapters: [adapter], onEvent: (event) => events.push(event),
  });
  assert.equal(marketCalls, 15);
  assert.equal(result.trace.toolCalls.length, 15);
  assert.equal(result.trace.toolAttempts, 15);
  assert.equal(result.trace.modelRequests, 16);
  assert.equal(result.trace.finalizedBy, 'model');
  assert.equal(result.trace.conclusion, 'answered');
  assert.equal(result.trace.conclusionSource, 'model');
  assert.match(result.message, /最终汇总/u);
  assert.equal(modes.filter((mode) => mode === 'finalize').length, 1);
  assert.equal(events.filter((event) => event.type === 'completed').length, 1);
});

test('D2a1：finalizer 再次请求业务工具被执行门禁拒绝并确定性收束，不执行第 16 次', async () => {
  let marketCalls = 0;
  const adapter = {
    id: 'synthetic-finalize-gate', adapterVersion: 2, supportsToolRoundTrip: true,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn() { return { turn: marketTurn() }; },
  };
  const profile = roundTripProfile('synthetic-finalize-gate', adapter);
  const events = [];
  const result = await runDesktopAgent({ requestId: 'd2a1-finalize-gate', message: '查行情。', modelProfileId: profile.id, context }, {
    marketQuery: async () => { marketCalls += 1; return structuredClone(MOCK_MARKET_QUERY_SUCCESS); },
    profiles: [profile], adapters: [adapter], onEvent: (event) => events.push(event),
  });
  assert.equal(marketCalls, 15);
  assert.equal(result.trace.toolAttempts, 15);
  assert.equal(result.trace.modelRequests, 16);
  assert.equal(result.trace.finalizedBy, 'harness');
  assert.equal(result.trace.conclusionSource, 'harness');
  assert.equal(result.trace.modelFailure.code, 'MODEL_BAD_RESPONSE');
  assert.match(result.trace.modelFailure.message, /执行门禁拒绝/u);
  assert.match(result.message, /示例 Prime/u);
  assert.equal(events.filter((event) => event.type === 'completed').length, 1);
  assert.ok(events.some((event) => event.type === 'model_error' && event.error.code === 'MODEL_BAD_RESPONSE'));
});

test('D2a1：finalizer 失败或输出非法时只做一次确定性程序收束', async () => {
  const variants = [
    {
      name: 'thrown', finalize: undefined,
      error: new ModelAdapterError({ code: 'MODEL_UNAVAILABLE', category: 'upstream', message: '最终汇总模型不可用。', retryable: true }),
    },
    { name: 'clarify', finalize: { kind: 'clarify', text: '请补充平台。', facts: [{ key: 'missing_field', value: 'platform' }] } },
    { name: 'conclude', finalize: { kind: 'conclude', text: '拒绝汇总。', conclusion: 'insufficient_data' } },
  ];
  for (const variant of variants) {
    let marketCalls = 0;
    const adapter = {
      id: `synthetic-finalize-${variant.name}`, adapterVersion: 2, supportsToolRoundTrip: true,
      async checkHealth() { return { available: true, summary: 'synthetic' }; },
      async generateTurn(input) {
        if (input.mode === 'finalize') {
          if (variant.error) throw variant.error;
          return { turn: variant.finalize };
        }
        return { turn: marketTurn() };
      },
    };
    const profile = roundTripProfile(adapter.id, adapter);
    const events = [];
    const result = await runDesktopAgent({ requestId: `d2a1-finalize-${variant.name}`, message: '查行情。', modelProfileId: profile.id, context }, {
      marketQuery: async () => { marketCalls += 1; return structuredClone(MOCK_MARKET_QUERY_SUCCESS); },
      profiles: [profile], adapters: [adapter], onEvent: (event) => events.push(event),
    });
    assert.equal(marketCalls, 15, variant.name);
    assert.equal(result.trace.toolAttempts, 15, variant.name);
    assert.equal(result.trace.finalizedBy, 'harness', variant.name);
    assert.equal(result.trace.conclusionSource, 'harness', variant.name);
    assert.equal(result.trace.modelFailure.code, variant.error ? 'MODEL_UNAVAILABLE' : 'MODEL_BAD_RESPONSE', variant.name);
    assert.equal(events.filter((event) => event.type === 'completed').length, 1, variant.name);
    assert.match(result.message, /示例 Prime/u, variant.name);
  }
});

test('D2a1：普通任务提前 answer 直接结束，不跑满 15 次也不附加最终汇总', async () => {
  const modes = [];
  const adapter = {
    id: 'synthetic-early-answer', adapterVersion: 2, supportsToolRoundTrip: true,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn(input) {
      modes.push(input.mode ?? 'decide');
      if (!input.history) return { turn: marketTurn() };
      return { turn: { kind: 'answer', text: '根据一次工具结果回答。' } };
    },
  };
  const profile = roundTripProfile('synthetic-early-answer', adapter);
  const events = [];
  const result = await runDesktopAgent({ requestId: 'd2a1-early-answer', message: '查行情。', modelProfileId: profile.id, context }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS),
    profiles: [profile], adapters: [adapter], onEvent: (event) => events.push(event),
  });
  assert.equal(result.trace.toolAttempts, 1);
  assert.equal(result.trace.modelRequests, 2);
  assert.equal(result.trace.finalizedBy, undefined);
  assert.equal(result.trace.conclusionSource, 'model');
  assert.deepEqual(modes, ['decide', 'decide']);
  assert.equal(events.filter((event) => event.type === 'completed').length, 1);
});

test('D2a1：模型请求预算预留第 24 次给最终汇总，决定轮不越界', async () => {
  const modes = [];
  let marketCalls = 0;
  const adapter = {
    id: 'synthetic-model-budget', adapterVersion: 2, supportsToolRoundTrip: true,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn(input) {
      modes.push(input.mode ?? 'decide');
      if (input.mode === 'finalize') return { turn: { kind: 'answer', text: '受限汇总。' } };
      return { turn: marketTurn() };
    },
  };
  const profile = roundTripProfile('synthetic-model-budget', adapter);
  const result = await runDesktopAgent({ requestId: 'd2a1-model-budget', message: '查行情。', modelProfileId: profile.id, context, runPolicy: { maxModelRequests: 4 } }, {
    marketQuery: async () => { marketCalls += 1; return structuredClone(MOCK_MARKET_QUERY_SUCCESS); },
    profiles: [profile], adapters: [adapter],
  });
  assert.equal(marketCalls, 3);
  assert.equal(result.trace.toolAttempts, 3);
  assert.equal(result.trace.modelRequests, 4);
  assert.equal(result.trace.finalizedBy, 'model');
  assert.deepEqual(modes, ['decide', 'decide', 'decide', 'finalize']);
});

test('D2a1：累计 token 预算耗尽后不再发起任何模型请求并确定性收束', async () => {
  const modes = [];
  const adapter = {
    id: 'synthetic-token-budget', adapterVersion: 2, supportsToolRoundTrip: true,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn(input) {
      modes.push(input.mode ?? 'decide');
      return { turn: marketTurn(), usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 } };
    },
  };
  const profile = roundTripProfile('synthetic-token-budget', adapter);
  const result = await runDesktopAgent({ requestId: 'd2a1-token-budget', message: '查行情。', modelProfileId: profile.id, context, runPolicy: { totalTokenBudget: 40 } }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS),
    profiles: [profile], adapters: [adapter],
  });
  assert.equal(result.trace.toolAttempts, 2);
  assert.equal(result.trace.modelRequests, 2);
  assert.equal(result.trace.finalizedBy, undefined);
  assert.equal(result.trace.conclusionSource, 'harness');
  assert.equal(result.trace.usage.totalTokens, 50);
  assert.deepEqual(modes, ['decide', 'decide']);
});

test('D2a1：外部取消后不再发起新的模型请求', async () => {
  const controller = new AbortController();
  let generateCalls = 0;
  const adapter = {
    id: 'synthetic-cancel-no-more', adapterVersion: 2, supportsToolRoundTrip: true,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn({ signal }) {
      generateCalls += 1;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
  };
  const profile = roundTripProfile('synthetic-cancel-no-more', adapter);
  const promise = runDesktopAgent({ requestId: 'd2a1-cancel-no-more', message: '查行情。', modelProfileId: profile.id, context }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS), profiles: [profile], adapters: [adapter], signal: controller.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.abort(new Error('cancelled'));
  const result = await promise;
  assert.equal(generateCalls, 1);
  assert.equal(result.trace.modelRequests, 1);
  assert.equal(result.trace.terminalReason, 'cancelled');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(generateCalls, 1);
});

test('D2a1：硬超时终止本轮，之后不再发起新的模型请求', async () => {
  let generateCalls = 0;
  const adapter = {
    id: 'synthetic-hard-timeout', adapterVersion: 2, supportsToolRoundTrip: true,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn() {
      generateCalls += 1;
      return new Promise(() => { /* ignore signal: late result must be isolated */ });
    },
  };
  const profile = roundTripProfile('synthetic-hard-timeout', adapter);
  const result = await runDesktopAgent({ requestId: 'd2a1-hard-timeout', message: '查行情。', modelProfileId: profile.id, context, runPolicy: { hardDeadlineMs: 300, finalizeReserveMs: 120 } }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS), profiles: [profile], adapters: [adapter],
  });
  assert.equal(generateCalls, 1);
  assert.equal(result.trace.modelRequests, 1);
  assert.equal(result.trace.terminalReason, 'timeout');
  assert.match(result.message, /超时/u);
});

test('D2a1：健康检查阶段超时归类为 timeout 且不会发起模型请求', async () => {
  let generateCalled = false;
  const adapter = {
    id: 'synthetic-health-timeout', adapterVersion: 2,
    async checkHealth() { return new Promise(() => { /* deliberately ignores cancellation */ }); },
    async generateTurn() { generateCalled = true; return { turn: marketTurn() }; },
  };
  const profile = roundTripProfile(adapter.id, adapter);
  const result = await runDesktopAgent({
    requestId: 'd2a1-health-timeout', message: '查行情。', modelProfileId: profile.id, context,
    runPolicy: { hardDeadlineMs: 300, healthTimeoutMs: 20 },
  }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS), profiles: [profile], adapters: [adapter],
  });
  assert.equal(generateCalled, false);
  assert.equal(result.trace.modelRequests, 0);
  assert.equal(result.trace.terminalReason, 'timeout');
  assert.equal(result.trace.modelFailure.code, 'MODEL_TIMEOUT');
});

test('D2a1：健康检查与领域工具收到同一取消信号并响应；迟到工具结果被隔离', async () => {
  // 健康检查阶段取消：checkHealth 收到信号并中止，模型生成不被调用。
  const controller = new AbortController();
  let healthSignal;
  let healthAborted = false;
  let generateCalled = false;
  const healthAdapter = {
    id: 'synthetic-health-cancel', adapterVersion: 2,
    async checkHealth(_profile, signal) {
      healthSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
        healthAborted = true;
        reject(signal.reason);
      }, { once: true }));
    },
    async generateTurn() { generateCalled = true; return { turn: marketTurn() }; },
  };
  const healthProfile = {
    id: 'synthetic-health-cancel', label: 'Synthetic', adapterId: healthAdapter.id, model: 'synthetic', description: 'synthetic',
    capabilities: { ...ROUND_TRIP_CAPABILITIES },
  };
  const promise = runDesktopAgent({ requestId: 'd2a1-health-cancel', message: '查行情。', modelProfileId: healthProfile.id, context }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS), profiles: [healthProfile], adapters: [healthAdapter], signal: controller.signal,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.abort(new Error('cancelled'));
  const healthResult = await promise;
  assert.equal(healthSignal instanceof AbortSignal, true);
  assert.equal(healthAborted, true);
  assert.equal(generateCalled, false);
  assert.equal(healthResult.trace.terminalReason, 'cancelled');

  // 领域工具阶段取消：deps.marketQuery 收到同一运行信号；其后到达的迟到结果不得覆盖终态。
  const toolController = new AbortController();
  const events = [];
  let toolSignal;
  let toolRejected = false;
  const toolAdapter = {
    id: 'synthetic-tool-cancel', adapterVersion: 2, supportsToolRoundTrip: true,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn() { return { turn: marketTurn() }; },
  };
  const toolProfile = roundTripProfile('synthetic-tool-cancel', toolAdapter);
  const toolPromise = runDesktopAgent({ requestId: 'd2a1-tool-cancel', message: '查行情。', modelProfileId: toolProfile.id, context }, {
    marketQuery: (_request, signal) => {
      toolSignal = signal;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => { toolRejected = true; reject(signal.reason); }, { once: true });
      });
    },
    profiles: [toolProfile], adapters: [toolAdapter], signal: toolController.signal, onEvent: (event) => events.push(event),
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  toolController.abort(new Error('cancelled'));
  const toolResult = await toolPromise;
  assert.equal(toolSignal instanceof AbortSignal, true);
  assert.equal(toolRejected, true);
  assert.equal(toolResult.trace.terminalReason, 'cancelled');
  assert.equal(events.filter((event) => event.type === 'completed').length, 1);
  // 迟到的领域工具结果（忽略信号）在取消后到达：隔离，不产生新事件或第二个终态。
  let releaseLate;
  const lateController = new AbortController();
  const lateEvents = [];
  const latePromise = runDesktopAgent({ requestId: 'd2a1-late-result', message: '查行情。', modelProfileId: toolProfile.id, context }, {
    marketQuery: () => new Promise((resolve) => { releaseLate = resolve; }),
    profiles: [toolProfile], adapters: [toolAdapter], signal: lateController.signal, onEvent: (event) => lateEvents.push(event),
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  lateController.abort(new Error('cancelled'));
  const lateTerminal = await latePromise;
  assert.equal(lateTerminal.trace.terminalReason, 'cancelled');
  assert.equal(lateEvents.filter((event) => event.type === 'completed').length, 1);
  releaseLate(structuredClone(MOCK_MARKET_QUERY_SUCCESS));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(lateEvents.filter((event) => event.type === 'completed').length, 1);
  assert.equal(lateEvents.some((event) => event.type === 'tool_result'), false);
  assert.equal(lateTerminal.trace.toolAttempts, 1);
});

test('D2a1：finalize 流式候选在终态形状校验前不会泄漏到界面', async () => {
  const events = [];
  let marketCalls = 0;
  const adapter = {
    id: 'synthetic-finalize-buffer', adapterVersion: 2, supportsToolRoundTrip: true,
    async checkHealth() { return { available: true, summary: 'synthetic' }; },
    async generateTurn(input) {
      if (input.mode === 'finalize') {
        await input.onTextDelta?.('不应出现的候选文本');
        return { turn: marketTurn() };
      }
      return { turn: marketTurn() };
    },
  };
  const profile = roundTripProfile(adapter.id, adapter);
  const result = await runDesktopAgent({
    requestId: 'd2a1-finalize-buffer', message: '查行情。', modelProfileId: profile.id, context,
    runPolicy: { maxToolAttempts: 1 },
  }, {
    marketQuery: async () => { marketCalls += 1; return structuredClone(MOCK_MARKET_QUERY_SUCCESS); },
    profiles: [profile], adapters: [adapter], onEvent: (event) => events.push(event),
  });
  assert.equal(marketCalls, 1);
  assert.equal(result.trace.finalizedBy, 'harness');
  assert.equal(events.some((event) => event.type === 'message_delta' && event.delta.includes('不应出现')), false);
  assert.equal(events.filter((event) => event.type === 'completed').length, 1);
});

test('D2a1：事件通道故障时仍只提交一次终态', async () => {
  let completedCount = 0;
  const result = await runDesktopAgent({ requestId: 'd2a1-terminal-once', message: '查一下示例 Prime 蓝图当前行情，PC 跨平台，0级。', context }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS),
    onEvent: async (event) => {
      if (event.type === 'completed') { completedCount += 1; throw new Error('channel broken'); }
    },
  });
  assert.equal(completedCount, 1);
  assert.equal(result.trace.terminalReason, 'completed');
  assert.equal(result.trace.toolAttempts, 1);
});
