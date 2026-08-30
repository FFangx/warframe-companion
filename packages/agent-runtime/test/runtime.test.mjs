import assert from 'node:assert/strict';
import test from 'node:test';
import { ModelAdapterError, checkModelProfile, listModelProfiles, runDesktopAgent } from '../dist/index.js';
import { MOCK_MARKET_QUERY_FAILURES, MOCK_MARKET_QUERY_SUCCESS } from '@warframe-companion/market-query-contract/mocks';

const context = { channel: 'desktop', trustedOwner: true, now: '2030-01-02T03:04:05.000Z' };
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

test('回送轮：模型反复调用工具时在 3 轮上限后由 Harness 确定性收尾', async () => {
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
  assert.equal(marketCalls, 3);
  assert.equal(result.trace.toolCalls.length, 3);
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
