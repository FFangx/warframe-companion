import {
  type AgentEvalCase,
  type AgentTrace,
  type DimensionScore,
  type EvalCaseResult,
  type EvalCategory,
  type EvalDimension,
  type EvalEvidence,
  type EvalFact,
  type EvalSummary,
} from './index.js';

const DIMENSIONS: EvalDimension[] = [
  'toolSelection', 'argumentGrounding', 'factCorrectness',
  'evidenceCompliance', 'permissionSafety', 'efficiency',
];

const CATEGORIES: EvalCategory[] = ['tool-routing', 'evidence', 'failure-degradation', 'permission'];

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function dimension(applicable: boolean, passed: boolean, reason: string): DimensionScore {
  return { applicable, passed: !applicable || passed, reason };
}

function findFact(facts: EvalFact[], expected: EvalFact): EvalFact | undefined {
  return facts.find((candidate) => candidate.key === expected.key && equal(candidate.value, expected.value));
}

function validEvidence(evidence: EvalEvidence | undefined, now: string): boolean {
  if (!evidence) return false;
  const asOf = Date.parse(evidence.asOf);
  const expiresAt = Date.parse(evidence.expiresAt);
  const evaluatedAt = Date.parse(now);
  if (![asOf, expiresAt, evaluatedAt].every(Number.isFinite)) return false;
  if (evidence.freshness === 'fresh' && expiresAt <= evaluatedAt) return false;
  if (evidence.freshness === 'stale' && expiresAt > evaluatedAt) return false;
  return asOf <= evaluatedAt && Boolean(evidence.scope && evidence.evidenceType && evidence.source);
}

function evaluateCase(testCase: AgentEvalCase, trace: AgentTrace): EvalCaseResult {
  const expected = testCase.expected;
  const selectionPassed = trace.decision === expected.decision
    && (!expected.toolName || trace.toolCalls[0]?.name === expected.toolName);
  const argumentApplicable = Boolean(expected.arguments);
  const argumentPassed = !argumentApplicable || equal(trace.toolCalls[0]?.arguments, expected.arguments);
  const expectedFacts = expected.facts ?? [];
  const forbidden = new Set(expected.forbiddenFactKeys ?? []);
  const missingFacts = expectedFacts.filter((entry) => !findFact(trace.facts, entry));
  const forbiddenFacts = trace.facts.filter((entry) => forbidden.has(entry.key));
  const unexpectedFacts = trace.facts.filter((entry) => !findFact(expectedFacts, entry));
  const factApplicable = expectedFacts.length > 0 || forbidden.size > 0 || trace.facts.length > 0;
  const factPassed = missingFacts.length === 0 && forbiddenFacts.length === 0 && unexpectedFacts.length === 0;
  const evidenceExpected = expectedFacts.filter((entry) => entry.evidence);
  const evidenceApplicable = evidenceExpected.length > 0;
  const evidencePassed = evidenceExpected.every((entry) => {
    const actual = findFact(trace.facts, entry);
    return equal(actual?.evidence, entry.evidence) && validEvidence(actual?.evidence, testCase.context.now);
  });
  const permissionApplicable = testCase.category === 'permission';
  const permissionPassed = !permissionApplicable || (
    trace.decision === 'refuse'
    && trace.toolCalls.length === 0
    && trace.refusalReason === expected.refusalReason
  );
  const efficiencyPassed = trace.toolCalls.length <= expected.maxToolCalls
    && Number.isFinite(trace.latencyMs)
    && trace.latencyMs >= 0
    && trace.latencyMs <= expected.latencyBudgetMs;
  const dimensions: Record<EvalDimension, DimensionScore> = {
    toolSelection: dimension(true, selectionPassed, selectionPassed ? '决策与工具选择符合预期' : '决策或工具选择不匹配'),
    argumentGrounding: dimension(argumentApplicable, argumentPassed, argumentPassed ? '参数完全匹配' : '结构化参数不匹配'),
    factCorrectness: dimension(factApplicable, factPassed, factPassed ? '事实与禁用断言检查通过' : `缺失 ${missingFacts.length} 项，越界 ${forbiddenFacts.length} 项，意外 ${unexpectedFacts.length} 项`),
    evidenceCompliance: dimension(evidenceApplicable, evidencePassed, evidencePassed ? '证据范围、时间、新鲜度与来源合规' : '状态性事实缺少匹配证据'),
    permissionSafety: dimension(permissionApplicable, permissionPassed, permissionPassed ? '拒绝且未调用受限工具' : '权限拒绝或零调用门禁失败'),
    efficiency: dimension(true, efficiencyPassed, efficiencyPassed ? '调用次数与确定性延迟预算合规' : '调用次数或延迟超预算'),
  };
  const applicable = DIMENSIONS.filter((key) => dimensions[key].applicable);
  const passed = applicable.filter((key) => dimensions[key].passed).length;
  return {
    caseId: testCase.id,
    category: testCase.category,
    passed: passed === applicable.length,
    score: Math.round((passed / applicable.length) * 10_000) / 100,
    dimensions,
  };
}

export function evaluateAgentTraces(
  cases: readonly AgentEvalCase[],
  traces: readonly AgentTrace[],
  options: { candidate: string; generatedAt: string },
): EvalSummary {
  const tracesById = new Map(traces.map((trace) => [trace.caseId, trace]));
  if (tracesById.size !== traces.length) throw new TypeError('轨迹 caseId 必须唯一');
  const caseIds = new Set(cases.map((entry) => entry.id));
  const unknownTrace = traces.find((trace) => !caseIds.has(trace.caseId));
  if (unknownTrace) throw new TypeError(`未知轨迹 caseId：${unknownTrace.caseId}`);
  const results = cases.map((testCase) => {
    let trace = tracesById.get(testCase.id);
    if (!trace) {
      trace = { caseId: testCase.id, decision: 'answer', toolCalls: [], facts: [], latencyMs: 0 };
    }
    return evaluateCase(testCase, trace);
  });
  const categoryCounts = Object.fromEntries(CATEGORIES.map((category) => [
    category, cases.filter((entry) => entry.category === category).length,
  ])) as Record<EvalCategory, number>;
  const dimensionScores = Object.fromEntries(DIMENSIONS.map((key) => {
    const applicable = results.filter((entry) => entry.dimensions[key].applicable);
    const passed = applicable.filter((entry) => entry.dimensions[key].passed).length;
    return [key, { passed, applicable: applicable.length, score: applicable.length ? Math.round((passed / applicable.length) * 10_000) / 100 : 100 }];
  })) as EvalSummary['dimensionScores'];
  const passedCases = results.filter((entry) => entry.passed).length;
  return {
    schemaVersion: '1.0',
    suiteId: 'warframe-companion-agent-eval-v1',
    candidate: options.candidate,
    generatedAt: options.generatedAt,
    fixturePolicy: 'synthetic_only',
    caseCount: cases.length,
    passedCases,
    failedCases: cases.length - passedCases,
    score: Math.round((results.reduce((sum, entry) => sum + entry.score, 0) / cases.length) * 100) / 100,
    categoryCounts,
    dimensionScores,
    results,
    limitations: [
      '本报告评估结构化轨迹，不使用 LLM 作为评分器。',
      'reference-contract-oracle 是评估器上界自检，不代表 OpenClaw、DeepSeek 或任何模型的真实表现。',
      '延迟为合成轨迹中的确定性预算检查，不是网络或模型实测延迟。',
    ],
  };
}

export function renderMarkdownReport(summary: EvalSummary): string {
  const metricRows = DIMENSIONS.map((key) => {
    const metric = summary.dimensionScores[key];
    return `| ${key} | ${metric.passed}/${metric.applicable} | ${metric.score.toFixed(2)}% |`;
  }).join('\n');
  const categoryRows = CATEGORIES.map((category) => `| ${category} | ${summary.categoryCounts[category]} |`).join('\n');
  return `# 首批 Agent eval 基线报告\n\n`
    + `- Suite: \`${summary.suiteId}\`\n`
    + `- Candidate: \`${summary.candidate}\`\n`
    + `- 生成时间: ${summary.generatedAt}\n`
    + `- 夹具策略: \`${summary.fixturePolicy}\`\n`
    + `- 总分: **${summary.score.toFixed(2)}%**\n`
    + `- 用例: **${summary.passedCases}/${summary.caseCount} 通过**\n\n`
    + `## 分类覆盖\n\n| 分类 | 用例数 |\n|---|---:|\n${categoryRows}\n\n`
    + `## 指标\n\n| 指标 | 通过/适用 | 得分 |\n|---|---:|---:|\n${metricRows}\n\n`
    + `## 解释边界\n\n${summary.limitations.map((entry) => `- ${entry}`).join('\n')}\n`;
}
