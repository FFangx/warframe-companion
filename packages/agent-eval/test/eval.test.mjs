import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIRST_AGENT_EVAL_CASES,
  createReferenceTrace,
  evaluateAgentTraces,
  renderMarkdownReport,
  V2_AGENT_EVAL_CASES,
  auditAgentTracesV2,
  evaluateAgentTracesV2,
} from '../dist/index.js';

const generatedAt = '2030-01-02T03:04:05.000Z';

test('评估集包含原 30 条与 8 条掉落工具用例，并覆盖四个类别', () => {
  assert.equal(FIRST_AGENT_EVAL_CASES.length, 38);
  assert.deepEqual(
    Object.fromEntries(['tool-routing', 'evidence', 'failure-degradation', 'permission'].map((category) => [
      category, FIRST_AGENT_EVAL_CASES.filter((entry) => entry.category === category).length,
    ])),
    { 'tool-routing': 13, evidence: 11, 'failure-degradation': 8, permission: 6 },
  );
  assert.equal(FIRST_AGENT_EVAL_CASES.filter((entry) => entry.id.startsWith('drops-')).length, 8);
  assert.equal(new Set(FIRST_AGENT_EVAL_CASES.map((entry) => entry.id)).size, 38);
  assert.equal(V2_AGENT_EVAL_CASES.length, 30, '历史 v2 只重评原 30 条已保存 trace');
});

test('所有夹具均为合成数据且不含敏感键或本机路径', () => {
  const serialized = JSON.stringify(FIRST_AGENT_EVAL_CASES);
  assert.doesNotMatch(serialized, /api[_-]?key|market[_-]?token|authorization|bearer|qq\s*\d|[A-Z]:\\|%LOCALAPPDATA%/iu);
  assert.doesNotMatch(serialized, /ingameName|accountId|senderId|instanceId/iu);
});

test('参考契约基线 38 条全部通过并生成稳定报告', () => {
  const traces = FIRST_AGENT_EVAL_CASES.map(createReferenceTrace);
  const summary = evaluateAgentTraces(FIRST_AGENT_EVAL_CASES, traces, {
    candidate: 'reference-contract-oracle', generatedAt,
  });
  assert.equal(summary.caseCount, 38);
  assert.equal(summary.passedCases, 38);
  assert.equal(summary.score, 100);
  assert.match(renderMarkdownReport(summary), /38\/38 通过/u);
});

test('runner 会捕获错误工具、无证据断言、越权调用和超预算', () => {
  const testCase = FIRST_AGENT_EVAL_CASES.find((entry) => entry.id === 'permission-001');
  assert.ok(testCase);
  const summary = evaluateAgentTraces([testCase], [{
    caseId: testCase.id,
    decision: 'call_tool',
    toolCalls: [{ name: 'account.getSnapshot', arguments: {} }],
    facts: [{ key: 'personal.inventory', value: 'leaked' }],
    latencyMs: 900,
  }], { candidate: 'negative-control', generatedAt });
  assert.equal(summary.passedCases, 0);
  assert.equal(summary.results[0].dimensions.permissionSafety.passed, false);
  assert.equal(summary.results[0].dimensions.efficiency.passed, false);
  assert.equal(summary.results[0].dimensions.factCorrectness.passed, false);
});

test('runner 会捕获状态性事实的证据缺失', () => {
  const testCase = FIRST_AGENT_EVAL_CASES.find((entry) => entry.id === 'evidence-001');
  assert.ok(testCase);
  const trace = createReferenceTrace(testCase);
  trace.facts = trace.facts.map(({ evidence: _evidence, ...entry }) => entry);
  const summary = evaluateAgentTraces([testCase], [trace], { candidate: 'negative-control', generatedAt });
  assert.equal(summary.passedCases, 0);
  assert.equal(summary.results[0].dimensions.evidenceCompliance.passed, false);
});

test('runner 会拒绝未知轨迹并捕获额外事实', () => {
  const testCase = FIRST_AGENT_EVAL_CASES.find((entry) => entry.id === 'route-001');
  assert.ok(testCase);
  assert.throws(() => evaluateAgentTraces([testCase], [{
    caseId: 'unknown-case', decision: 'answer', toolCalls: [], facts: [], latencyMs: 1,
  }], { candidate: 'negative-control', generatedAt }), /未知轨迹 caseId/u);
  const trace = createReferenceTrace(testCase);
  trace.facts.push({ key: 'market.unsupported_claim', value: 'hallucinated' });
  const summary = evaluateAgentTraces([testCase], [trace], { candidate: 'negative-control', generatedAt });
  assert.equal(summary.results[0].dimensions.factCorrectness.passed, false);
});

test('runner 的结构比较不依赖对象键顺序', () => {
  const testCase = FIRST_AGENT_EVAL_CASES.find((entry) => entry.id === 'evidence-001');
  assert.ok(testCase);
  const trace = createReferenceTrace(testCase);
  const evidence = trace.facts[0].evidence;
  trace.facts[0].evidence = Object.fromEntries(Object.entries(evidence).reverse());
  const summary = evaluateAgentTraces([testCase], [trace], { candidate: 'key-order-control', generatedAt });
  assert.equal(summary.passedCases, 1);
});

test('v2 允许期望工具完成后的 answer 终态，并区分本地与远程延迟预算', () => {
  const testCase = V2_AGENT_EVAL_CASES.find((entry) => entry.id === 'route-006');
  assert.ok(testCase);
  const trace = createReferenceTrace(FIRST_AGENT_EVAL_CASES.find((entry) => entry.id === 'route-006'));
  trace.decision = 'answer';
  trace.latencyMs = 10_000;
  const remote = evaluateAgentTracesV2([testCase], [trace], { candidate: 'remote-control', generatedAt, latencyClass: 'remote_model' });
  const local = evaluateAgentTracesV2([testCase], [trace], { candidate: 'local-control', generatedAt, latencyClass: 'local_harness' });
  assert.equal(remote.results[0].dimensions.toolSelection.passed, true);
  assert.equal(remote.results[0].dimensions.efficiency.passed, true);
  assert.equal(local.results[0].dimensions.efficiency.passed, false);
});

test('v2 允许受工具支持的额外事实，但无支撑事实仍触发安全门禁', () => {
  const testCase = V2_AGENT_EVAL_CASES.find((entry) => entry.id === 'evidence-001');
  const v1Case = FIRST_AGENT_EVAL_CASES.find((entry) => entry.id === 'evidence-001');
  assert.ok(testCase && v1Case);
  const trace = createReferenceTrace(v1Case);
  trace.facts.push({ key: 'market.sell_orders', value: 1, evidence: structuredClone(trace.facts[0].evidence) });
  let summary = evaluateAgentTracesV2([testCase], [trace], { candidate: 'supported-extra', generatedAt, latencyClass: 'local_harness' });
  assert.equal(summary.results[0].dimensions.factCorrectness.passed, true);
  assert.equal(summary.results[0].safetyGates.claimGrounding.passed, true);
  trace.facts.push({ key: 'market.current_price', value: 999, evidence: structuredClone(trace.facts[0].evidence) });
  summary = evaluateAgentTracesV2([testCase], [trace], { candidate: 'hallucination-control', generatedAt, latencyClass: 'local_harness' });
  assert.equal(summary.results[0].dimensions.factCorrectness.passed, true);
  assert.equal(summary.results[0].safetyGates.claimGrounding.passed, false);
  assert.equal(summary.passedCases, 0);
});

test('v2 审核区分名称规范化候选与真实参数语义漂移', () => {
  const cases = V2_AGENT_EVAL_CASES.filter((entry) => ['route-001', 'route-003'].includes(entry.id));
  const traces = cases.map((entry) => createReferenceTrace(FIRST_AGENT_EVAL_CASES.find((candidate) => candidate.id === entry.id)));
  traces[0].toolCalls[0].arguments.item = 'Axi V3 Relic';
  traces[1].toolCalls[0].arguments.rank = 'max';
  const audits = auditAgentTracesV2(cases, traces);
  assert.equal(audits[0].argumentMutations[0].classification, 'normalization_candidate');
  assert.equal(audits[1].argumentMutations[0].classification, 'semantic_mismatch');
});
