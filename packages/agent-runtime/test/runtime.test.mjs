import assert from 'node:assert/strict';
import test from 'node:test';
import { checkModelProfile, listModelProfiles, runDesktopAgent } from '../dist/index.js';
import { MOCK_MARKET_QUERY_SUCCESS } from '@warframe-companion/market-query-contract/mocks';

const context = { channel: 'desktop', trustedOwner: true, now: '2030-01-02T03:04:05.000Z' };

test('桌面 Harness 执行市场工具并流式导出同一轨迹', async () => {
  const events = [];
  const result = await runDesktopAgent({ requestId: 'synthetic-run', message: '查一下示例 Prime 蓝图当前行情，PC 跨平台，0级。', context }, {
    marketQuery: async () => structuredClone(MOCK_MARKET_QUERY_SUCCESS), onEvent: (event) => events.push(event), now: () => 100,
  });
  assert.equal(result.trace.decision, 'call_tool');
  assert.equal(result.trace.toolCalls[0].name, 'market.query');
  assert.ok(events.some((event) => event.type === 'tool_call'));
  assert.ok(events.some((event) => event.type === 'message_delta'));
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

test('未接入的个人快照不会误路由到市场工具', async () => {
  let called = false;
  const result = await runDesktopAgent({ requestId: 'synthetic-personal', message: '读取我的个人库存。', context }, {
    marketQuery: async () => { called = true; return structuredClone(MOCK_MARKET_QUERY_SUCCESS); },
  });
  assert.equal(result.trace.decision, 'answer');
  assert.match(result.message, /尚未接入个人快照/u);
  assert.equal(called, false);
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
    id: 'synthetic-pending',
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
