import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIRST_AGENT_EVAL_CASES,
  createReferenceTrace,
  evaluateAgentTraces,
  renderMarkdownReport,
} from '../dist/index.js';

const generatedAt = '2030-01-02T03:04:05.000Z';

test('首批评估固定为 30 条并覆盖四个类别', () => {
  assert.equal(FIRST_AGENT_EVAL_CASES.length, 30);
  assert.deepEqual(
    Object.fromEntries(['tool-routing', 'evidence', 'failure-degradation', 'permission'].map((category) => [
      category, FIRST_AGENT_EVAL_CASES.filter((entry) => entry.category === category).length,
    ])),
    { 'tool-routing': 10, evidence: 8, 'failure-degradation': 6, permission: 6 },
  );
  assert.equal(new Set(FIRST_AGENT_EVAL_CASES.map((entry) => entry.id)).size, 30);
});

test('所有夹具均为合成数据且不含敏感键或本机路径', () => {
  const serialized = JSON.stringify(FIRST_AGENT_EVAL_CASES);
  assert.doesNotMatch(serialized, /api[_-]?key|market[_-]?token|authorization|bearer|qq\s*\d|[A-Z]:\\|%LOCALAPPDATA%/iu);
  assert.doesNotMatch(serialized, /ingameName|accountId|senderId|instanceId/iu);
});

test('参考契约基线 30 条全部通过并生成稳定报告', () => {
  const traces = FIRST_AGENT_EVAL_CASES.map(createReferenceTrace);
  const summary = evaluateAgentTraces(FIRST_AGENT_EVAL_CASES, traces, {
    candidate: 'reference-contract-oracle', generatedAt,
  });
  assert.equal(summary.caseCount, 30);
  assert.equal(summary.passedCases, 30);
  assert.equal(summary.score, 100);
  assert.match(renderMarkdownReport(summary), /30\/30 通过/u);
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
