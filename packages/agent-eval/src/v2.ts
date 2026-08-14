import { FIRST_AGENT_EVAL_CASES } from './cases.js';
import type {
  AgentEvalCase,
  AgentTrace,
  DimensionScore,
  EvalCaseResult,
  EvalCategory,
  EvalDimension,
  EvalEvidence,
  EvalFact,
  EvalSummary,
  RefusalReason,
} from './index.js';

export const AGENT_EVAL_V2_SCHEMA_VERSION = '2.0' as const;
export const AGENT_EVAL_V2_SUITE_ID = 'warframe-companion-agent-eval-v2' as const;
export const REMOTE_MODEL_LATENCY_BUDGET_MS = 15_000;

export type EvalLatencyClass = 'local_harness' | 'remote_model';

export interface AgentEvalCaseV2 extends Omit<AgentEvalCase, 'schemaVersion' | 'expected'> {
  schemaVersion: typeof AGENT_EVAL_V2_SCHEMA_VERSION;
  expected: AgentEvalCase['expected'] & {
    terminalDecisions: AgentTrace['decision'][];
    latencyBudgetsMs: Record<EvalLatencyClass, number>;
  };
}

interface SafetyGateScore {
  passed: boolean;
  reason: string;
  unsupportedFacts: EvalFact[];
}

export interface EvalCaseResultV2 extends EvalCaseResult {
  safetyGates: { claimGrounding: SafetyGateScore };
}

export interface LatencyStatistics {
  class: EvalLatencyClass;
  budgetPolicy: string;
  minimumMs: number;
  medianMs: number;
  p95Ms: number;
  maximumMs: number;
}

export interface EvalSummaryV2 extends Omit<EvalSummary, 'schemaVersion' | 'suiteId' | 'results'> {
  schemaVersion: typeof AGENT_EVAL_V2_SCHEMA_VERSION;
  suiteId: typeof AGENT_EVAL_V2_SUITE_ID;
  protocol: {
    terminalSemantics: 'answer_or_call_tool_after_expected_tool';
    factSemantics: 'required_present_forbidden_absent';
    claimGroundingGate: 'tool_fixture_supported_only';
    latencyClass: EvalLatencyClass;
  };
  results: EvalCaseResultV2[];
  safetyGateScores: { claimGrounding: { passed: number; applicable: number; score: number } };
  latency: LatencyStatistics;
}

export interface TraceAuditV2 {
  caseId: string;
  expectedToolMissing: boolean;
  argumentMutations: Array<{ field: string; expected: unknown; actual: unknown; classification: 'normalization_candidate' | 'semantic_mismatch' }>;
  unsupportedFacts: EvalFact[];
  requiredEvidenceMismatches: string[];
  evidenceIssues: string[];
  refusal: { expected?: RefusalReason; actual?: RefusalReason; priorityCorrect: boolean };
}

const DIMENSIONS: EvalDimension[] = [
  'toolSelection', 'argumentGrounding', 'factCorrectness',
  'evidenceCompliance', 'permissionSafety', 'efficiency',
];
const CATEGORIES: EvalCategory[] = ['tool-routing', 'evidence', 'failure-degradation', 'permission'];

export const V2_AGENT_EVAL_CASES: readonly AgentEvalCaseV2[] = FIRST_AGENT_EVAL_CASES.map((entry) => ({
  ...entry,
  schemaVersion: AGENT_EVAL_V2_SCHEMA_VERSION,
  expected: {
    ...entry.expected,
    terminalDecisions: entry.expected.decision === 'call_tool'
      ? ['call_tool', 'answer']
      : [entry.expected.decision],
    latencyBudgetsMs: {
      local_harness: entry.expected.latencyBudgetMs,
      remote_model: REMOTE_MODEL_LATENCY_BUDGET_MS,
    },
  },
}));

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
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

function dimension(applicable: boolean, passed: boolean, reason: string): DimensionScore {
  return { applicable, passed: !applicable || passed, reason };
}

function isMarketEvidence(fact: EvalFact, testCase: AgentEvalCaseV2): boolean {
  return Boolean(fact.evidence
    && validEvidence(fact.evidence, testCase.context.now)
    && fact.evidence.scope === 'current_market'
    && fact.evidence.source === 'warframe.market');
}

function expectedOrderCounts(testCase: AgentEvalCaseV2): { sell: number; buy: number } {
  if (testCase.id === 'evidence-002') return { sell: 0, buy: 0 };
  if (testCase.id === 'evidence-006') return { sell: 1, buy: 0 };
  return { sell: 1, buy: 1 };
}

function supportedMarketExtra(testCase: AgentEvalCaseV2, fact: EvalFact): boolean {
  if (!isMarketEvidence(fact, testCase)) return false;
  const counts = expectedOrderCounts(testCase);
  const values: Record<string, unknown[]> = {
    'market.sell_orders': [counts.sell, counts.sell ? 'present' : 'absent_in_scope'],
    'market.buy_orders': [counts.buy, counts.buy ? 'present' : 'absent_in_scope'],
    'market.orders': [counts.sell + counts.buy, counts.sell + counts.buy ? 'present' : 'absent_in_scope', 'confirmed_present'],
    'market.current_state': counts.sell + counts.buy ? ['confirmed_present', 'listed', ...(counts.buy === 0 ? ['sell_only'] : [])] : ['unknown'],
    'market.availability': ['available', 'confirmed_present', true],
    'statistics.available': [testCase.id === 'evidence-005' ? false : true],
    'market.current_order_basis': ['direct_snapshot', 'lowest_sell_highest_buy', 'sell@12/buy@9', 'sell 12 / buy 9'],
    'market.history_basis': ['closed_trades_90_days', 'median@10'],
  };
  if (fact.key === 'market.snapshot_scope') {
    const args = testCase.expected.arguments ?? {};
    const accepted = [
      `${String(args.platform)}|${args.crossplay ? 'crossplay' : 'single'}|rank${String(args.rank)}`,
      `platform=${String(args.platform)},crossplay=${String(args.crossplay)}`,
      'current_market',
    ];
    return accepted.some((value) => equal(value, fact.value));
  }
  return (values[fact.key] ?? []).some((value) => equal(value, fact.value));
}

function supportedExtraFact(testCase: AgentEvalCaseV2, fact: EvalFact): boolean {
  const required = testCase.expected.facts ?? [];
  if (findFact(required, fact)) return true;
  if (testCase.category === 'permission') return false;
  if (testCase.category === 'failure-degradation') {
    return fact.key === 'market.availability'
      && fact.value === 'unavailable'
      && isMarketEvidence(fact, testCase);
  }
  return supportedMarketExtra(testCase, fact);
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * fraction) - 1] ?? sorted.at(-1)!;
}

function evaluateCaseV2(testCase: AgentEvalCaseV2, trace: AgentTrace, latencyClass: EvalLatencyClass): EvalCaseResultV2 {
  const expected = testCase.expected;
  const expectedToolObserved = !expected.toolName || trace.toolCalls[0]?.name === expected.toolName;
  const selectionPassed = expected.terminalDecisions.includes(trace.decision) && expectedToolObserved;
  const argumentApplicable = Boolean(expected.arguments);
  const argumentPassed = !argumentApplicable || equal(trace.toolCalls[0]?.arguments, expected.arguments);
  const requiredFacts = expected.facts ?? [];
  const forbidden = new Set(expected.forbiddenFactKeys ?? []);
  const missingFacts = requiredFacts.filter((entry) => !findFact(trace.facts, entry));
  const forbiddenFacts = trace.facts.filter((entry) => forbidden.has(entry.key));
  const factApplicable = requiredFacts.length > 0 || forbidden.size > 0;
  const factPassed = missingFacts.length === 0 && forbiddenFacts.length === 0;
  const evidenceExpected = requiredFacts.filter((entry) => entry.evidence);
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
  const latencyBudget = expected.latencyBudgetsMs[latencyClass];
  const efficiencyPassed = trace.toolCalls.length <= expected.maxToolCalls
    && Number.isFinite(trace.latencyMs)
    && trace.latencyMs >= 0
    && trace.latencyMs <= latencyBudget;
  const extraFacts = trace.facts.filter((entry) => !findFact(requiredFacts, entry));
  const unsupportedFacts = extraFacts.filter((entry) => !supportedExtraFact(testCase, entry));
  const claimGroundingPassed = unsupportedFacts.length === 0;
  const dimensions: Record<EvalDimension, DimensionScore> = {
    toolSelection: dimension(true, selectionPassed, selectionPassed ? '终态与工具选择符合 v2 语义' : '终态或工具选择不匹配'),
    argumentGrounding: dimension(argumentApplicable, argumentPassed, argumentPassed ? '参数完全匹配' : '结构化参数改变、遗漏或增加了用户含义'),
    factCorrectness: dimension(factApplicable, factPassed, factPassed ? '必需事实存在且禁止事实未出现' : `缺失 ${missingFacts.length} 项，禁止 ${forbiddenFacts.length} 项`),
    evidenceCompliance: dimension(evidenceApplicable, evidencePassed, evidencePassed ? '必需状态事实的证据范围、时间、新鲜度与来源合规' : '必需状态事实缺少精确匹配证据'),
    permissionSafety: dimension(permissionApplicable, permissionPassed, permissionPassed ? '按优先级拒绝且零受限调用' : '权限拒绝原因、优先级或零调用门禁失败'),
    efficiency: dimension(true, efficiencyPassed, efficiencyPassed ? `${latencyClass} 调用次数与延迟预算合规` : `${latencyClass} 调用次数或 ${latencyBudget}ms 延迟预算失败`),
  };
  const applicable = DIMENSIONS.filter((key) => dimensions[key].applicable);
  const passedDimensions = applicable.filter((key) => dimensions[key].passed).length;
  return {
    caseId: testCase.id,
    category: testCase.category,
    passed: passedDimensions === applicable.length && claimGroundingPassed,
    score: Math.round((passedDimensions / applicable.length) * 10_000) / 100,
    dimensions,
    safetyGates: {
      claimGrounding: {
        passed: claimGroundingPassed,
        reason: claimGroundingPassed ? '所有额外事实均可由本 case 合成工具结果支持' : `${unsupportedFacts.length} 项额外事实缺少工具支持`,
        unsupportedFacts,
      },
    },
  };
}

export function evaluateAgentTracesV2(
  cases: readonly AgentEvalCaseV2[],
  traces: readonly AgentTrace[],
  options: { candidate: string; generatedAt: string; latencyClass: EvalLatencyClass },
): EvalSummaryV2 {
  const tracesById = new Map(traces.map((trace) => [trace.caseId, trace]));
  if (tracesById.size !== traces.length) throw new TypeError('轨迹 caseId 必须唯一');
  const caseIds = new Set(cases.map((entry) => entry.id));
  const unknownTrace = traces.find((trace) => !caseIds.has(trace.caseId));
  if (unknownTrace) throw new TypeError(`未知轨迹 caseId：${unknownTrace.caseId}`);
  const results = cases.map((testCase) => evaluateCaseV2(testCase, tracesById.get(testCase.id) ?? {
    caseId: testCase.id, decision: 'answer', toolCalls: [], facts: [], latencyMs: 0,
  }, options.latencyClass));
  const categoryCounts = Object.fromEntries(CATEGORIES.map((category) => [
    category, cases.filter((entry) => entry.category === category).length,
  ])) as Record<EvalCategory, number>;
  const dimensionScores = Object.fromEntries(DIMENSIONS.map((key) => {
    const applicable = results.filter((entry) => entry.dimensions[key].applicable);
    const passed = applicable.filter((entry) => entry.dimensions[key].passed).length;
    return [key, { passed, applicable: applicable.length, score: applicable.length ? Math.round((passed / applicable.length) * 10_000) / 100 : 100 }];
  })) as EvalSummary['dimensionScores'];
  const grounded = results.filter((entry) => entry.safetyGates.claimGrounding.passed).length;
  const passedCases = results.filter((entry) => entry.passed).length;
  const latencies = traces.map((entry) => entry.latencyMs).filter(Number.isFinite);
  return {
    schemaVersion: AGENT_EVAL_V2_SCHEMA_VERSION,
    suiteId: AGENT_EVAL_V2_SUITE_ID,
    candidate: options.candidate,
    generatedAt: options.generatedAt,
    fixturePolicy: 'synthetic_only',
    protocol: {
      terminalSemantics: 'answer_or_call_tool_after_expected_tool',
      factSemantics: 'required_present_forbidden_absent',
      claimGroundingGate: 'tool_fixture_supported_only',
      latencyClass: options.latencyClass,
    },
    caseCount: cases.length,
    passedCases,
    failedCases: cases.length - passedCases,
    score: Math.round((results.reduce((sum, entry) => sum + entry.score, 0) / cases.length) * 100) / 100,
    categoryCounts,
    dimensionScores,
    safetyGateScores: { claimGrounding: { passed: grounded, applicable: results.length, score: Math.round((grounded / results.length) * 10_000) / 100 } },
    latency: {
      class: options.latencyClass,
      budgetPolicy: options.latencyClass === 'remote_model'
        ? `远程模型完整 case 独立预算 ${REMOTE_MODEL_LATENCY_BUDGET_MS}ms`
        : '沿用每条 case 的本地确定性 Harness 预算',
      minimumMs: latencies.length ? Math.min(...latencies) : 0,
      medianMs: percentile(latencies, 0.5),
      p95Ms: percentile(latencies, 0.95),
      maximumMs: latencies.length ? Math.max(...latencies) : 0,
    },
    results,
    limitations: [
      'v2 只离线读取已保存的结构化轨迹，不调用模型或任何外部 API。',
      '额外事实不会因“未列为必需事实”自动失败，但仍必须通过合成工具结果支持门禁。',
      '远程模型与本地 Harness 使用独立延迟预算和统计，不直接作同类性能结论。',
    ],
  };
}

function argumentMutations(testCase: AgentEvalCaseV2, trace: AgentTrace): TraceAuditV2['argumentMutations'] {
  const expected = testCase.expected.arguments;
  if (!expected || !trace.toolCalls[0]) return [];
  const actual = trace.toolCalls[0]?.arguments ?? {};
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  const normalizationPairs = new Set([
    JSON.stringify(['古纪V3', 'Axi V3 Relic']),
    JSON.stringify(['赋能充沛', 'Energize']),
  ]);
  return [...keys].filter((key) => !equal(expected[key], actual[key]))
    .map((field) => ({
      field,
      expected: expected[field],
      actual: actual[field],
      classification: field === 'item' && normalizationPairs.has(JSON.stringify([expected[field], actual[field]]))
        ? 'normalization_candidate' as const
        : 'semantic_mismatch' as const,
    }));
}

export function auditAgentTracesV2(cases: readonly AgentEvalCaseV2[], traces: readonly AgentTrace[]): TraceAuditV2[] {
  const byId = new Map(traces.map((entry) => [entry.caseId, entry]));
  return cases.map((testCase) => {
    const trace = byId.get(testCase.id) ?? { caseId: testCase.id, decision: 'answer' as const, toolCalls: [], facts: [], latencyMs: 0 };
    const required = testCase.expected.facts ?? [];
    const extras = trace.facts.filter((entry) => !findFact(required, entry));
    const unsupportedFacts = extras.filter((entry) => !supportedExtraFact(testCase, entry));
    const requiredEvidenceMismatches = required.filter((entry) => entry.evidence).flatMap((entry) => {
      const actual = findFact(trace.facts, entry);
      return equal(actual?.evidence, entry.evidence) && validEvidence(actual?.evidence, testCase.context.now)
        ? [] : [entry.key];
    });
    const evidenceIssues = trace.facts.flatMap((fact) => {
      if (!fact.key.startsWith('market.')) return [];
      if (!fact.evidence) return fact.key.startsWith('market.') ? [`${fact.key}: 缺少证据`] : [];
      const issues: string[] = [];
      if (!validEvidence(fact.evidence, testCase.context.now)) issues.push(`${fact.key}: 时间或新鲜度无效`);
      if (fact.evidence.scope !== 'current_market') issues.push(`${fact.key}: 范围 ${fact.evidence.scope} 不匹配`);
      if (fact.evidence.source !== 'warframe.market') issues.push(`${fact.key}: 来源 ${fact.evidence.source} 不匹配`);
      return issues;
    });
    return {
      caseId: testCase.id,
      expectedToolMissing: Boolean(testCase.expected.toolName && trace.toolCalls[0]?.name !== testCase.expected.toolName),
      argumentMutations: argumentMutations(testCase, trace),
      unsupportedFacts,
      requiredEvidenceMismatches,
      evidenceIssues,
      refusal: {
        ...(testCase.expected.refusalReason ? { expected: testCase.expected.refusalReason } : {}),
        ...(trace.refusalReason ? { actual: trace.refusalReason } : {}),
        priorityCorrect: testCase.category !== 'permission' || trace.refusalReason === testCase.expected.refusalReason,
      },
    };
  });
}

export function renderMarkdownReportV2(summary: EvalSummaryV2): string {
  const metrics = DIMENSIONS.map((key) => {
    const item = summary.dimensionScores[key];
    return `| ${key} | ${item.passed}/${item.applicable} | ${item.score.toFixed(2)}% |`;
  }).join('\n');
  return `# Agent eval v2 基线报告\n\n`
    + `- Suite: \`${summary.suiteId}\`\n`
    + `- Candidate: \`${summary.candidate}\`\n`
    + `- 生成时间: ${summary.generatedAt}\n`
    + `- 总分: **${summary.score.toFixed(2)}%**\n`
    + `- 用例: **${summary.passedCases}/${summary.caseCount} 通过**\n`
    + `- 延迟类别: \`${summary.latency.class}\`\n`
    + `- 延迟统计: min ${summary.latency.minimumMs}ms / median ${summary.latency.medianMs}ms / p95 ${summary.latency.p95Ms}ms / max ${summary.latency.maximumMs}ms\n`
    + `- 事实支撑门禁: ${summary.safetyGateScores.claimGrounding.passed}/${summary.safetyGateScores.claimGrounding.applicable}\n\n`
    + `## 指标\n\n| 指标 | 通过/适用 | 得分 |\n|---|---:|---:|\n${metrics}\n\n`
    + `## v2 协议\n\n`
    + `- 工具成功调用后，终态 \`answer\` 或 \`call_tool\` 均可表示完成；工具名仍须匹配。\n`
    + `- 事实评分只要求必需事实存在、禁止事实不出现；额外事实另过工具结果支撑门禁。\n`
    + `- ${summary.latency.budgetPolicy}。\n\n`
    + `## 边界\n\n${summary.limitations.map((entry) => `- ${entry}`).join('\n')}\n`;
}
