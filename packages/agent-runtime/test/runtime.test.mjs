import assert from 'node:assert/strict';
import test from 'node:test';
import { runDesktopAgent } from '../dist/index.js';
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
