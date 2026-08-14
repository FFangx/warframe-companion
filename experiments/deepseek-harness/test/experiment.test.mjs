import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DSH_MARKET_TOOL,
  DSH_SUBMIT_TOOL,
  createMarketToolDefinition,
  createSubmitToolDefinition,
  policyDenialForTest,
} from '../dist/plugin.js';
import { assertSubmissionConsistent, createAgentTraceFromDsh, observeToolResult } from '../dist/trace-adapter.js';
import { assertTerminalSubmission, waitForAgentCycle } from '../dist/dsh-driver.js';

const permissionCase = {
  id: 'permission-test', category: 'permission', prompt: 'synthetic',
  context: { channel: 'untrusted_test', trustedOwner: false, now: '2030-01-02T03:04:05.000Z' },
  availableTools: ['account.getSnapshot'],
};

test('Market 插件把 DSH 工具参数原样映射到只读逻辑工具', async () => {
  let received;
  const definition = createMarketToolDefinition(async (args) => {
    received = args;
    return { ok: true, evidence: { source: 'warframe.market' } };
  });
  assert.equal(definition.name, DSH_MARKET_TOOL);
  const args = { contractVersion: '1.0', item: 'Synthetic Prime', platform: 'pc', crossplay: true, rank: 0 };
  const result = await definition.execute(args);
  assert.deepEqual(received, args);
  assert.deepEqual(result, { ok: true, evidence: { source: 'warframe.market' } });
});

test('可信上下文门禁拒绝个人读取且不依赖模型参数', () => {
  assert.equal(policyDenialForTest(permissionCase, 'account_get_snapshot'), 'identity_untrusted');
  assert.equal(policyDenialForTest(permissionCase, DSH_MARKET_TOOL), undefined);
  assert.equal(policyDenialForTest(permissionCase, DSH_SUBMIT_TOOL), undefined);
});

test('终态工具只接收模型判断并调用 concludeTurn', async () => {
  let accepted;
  let concluded = false;
  const definition = createSubmitToolDefinition((value) => { accepted = value; });
  const submission = { decision: 'refuse', facts: [], refusalReason: 'identity_untrusted' };
  assert.deepEqual(await definition.execute(submission, { concludeTurn() { concluded = true; } }), { accepted: true });
  assert.deepEqual(accepted, submission);
  assert.equal(concluded, true);
});

test('适配器从 session/event 派生调用并排除终态工具', () => {
  const events = [
    { type: 'tool/call', time: 10, data: { name: DSH_MARKET_TOOL, arguments: '{"item":"Synthetic Prime"}' } },
    { type: 'tool/call', time: 20, data: { name: DSH_SUBMIT_TOOL, arguments: '{"decision":"call_tool"}' } },
  ];
  const submission = { decision: 'call_tool', facts: [{ key: 'market.orders', value: 'present' }] };
  const trace = createAgentTraceFromDsh({ caseId: 'route-test', events, toolResults: [], submission, startedAt: 1_000, finishedAt: 1_321 });
  assert.deepEqual(trace.toolCalls, [{ name: 'market.query', arguments: { item: 'Synthetic Prime' } }]);
  assert.equal(trace.latencyMs, 321);
  assert.doesNotThrow(() => assertSubmissionConsistent(trace, [{ name: 'market.query', arguments: {}, isError: false, value: {} }]));
});

test('缺少终态提交不能被转换成看似有效的普通回答', () => {
  assert.throws(
    () => assertTerminalSubmission('missing-submit', undefined, []),
    /ended without submit_agent_trace/u,
  );
});

test('tools/result 观察只保留规范值，不带异常或凭据字段', () => {
  const observed = observeToolResult(
    { name: DSH_MARKET_TOOL, arguments: { item: 'Synthetic Prime' } },
    { isError: false, value: { ok: true, data: { synthetic: true } }, content: [{ type: 'text', text: 'ignored' }] },
  );
  assert.deepEqual(observed, {
    name: 'market.query', arguments: { item: 'Synthetic Prime' }, isError: false,
    value: { ok: true, data: { synthetic: true } },
  });
  assert.doesNotMatch(JSON.stringify(observed), /api[_-]?key|authorization|bearer|[A-Z]:\\/iu);
});

test('Agent 完成门禁忽略创建时 idle，只接受 running 到 idle 的完整周期', async () => {
  let listener;
  const ctx = {
    on(_name, callback) {
      listener = callback;
      return () => { listener = undefined; };
    },
  };
  const agent = {};
  let completed = false;
  const waiting = waitForAgentCycle(ctx, agent, 1_000).then(() => { completed = true; });
  listener({ agent, status: 'idle' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(completed, false);
  listener({ agent, status: 'running' });
  listener({ agent, status: 'idle' });
  await waiting;
  assert.equal(completed, true);
});

test('实验源码与测试夹具不含密钥、账号标识或本机绝对路径', async () => {
  const { readFile } = await import('node:fs/promises');
  const { glob } = await import('node:fs/promises');
  const files = [];
  for await (const path of glob(['src/**/*.ts', 'test/**/*.mjs'])) files.push(path);
  const text = (await Promise.all(files.map((path) => readFile(path, 'utf8')))).join('\n');
  const forbidden = new RegExp([
    'sk-' + '[A-Za-z0-9]{12,}',
    'market[_-]?' + 'token\\s*[:=]',
    'qq\\s*' + '\\d{5,}',
    'account' + 'Id',
    'sender' + 'Id',
    '[A-Z]:' + '\\\\Users\\\\',
  ].join('|'), 'iu');
  assert.doesNotMatch(text, forbidden);
});
