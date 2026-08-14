import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIRST_AGENT_EVAL_CASES, evaluateAgentTraces, type AgentTrace, type EvalSummary } from './index.js';
import {
  V2_AGENT_EVAL_CASES,
  auditAgentTracesV2,
  evaluateAgentTracesV2,
  renderMarkdownReportV2,
  type EvalSummaryV2,
  type TraceAuditV2,
} from './v2.js';

const GENERATED_AT = '2026-08-14T00:00:00.000Z';
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const companionRoot = resolve(packageRoot, '..', '..');
const reportsRoot = resolve(packageRoot, 'reports', 'v2');
const experimentReports = resolve(companionRoot, 'experiments', 'deepseek-harness', 'reports');

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function metricDelta(v1: EvalSummary, v2: EvalSummaryV2) {
  return Object.fromEntries(Object.keys(v2.dimensionScores).map((key) => {
    const dimension = key as keyof EvalSummary['dimensionScores'];
    return [key, Math.round((v2.dimensionScores[dimension].score - v1.dimensionScores[dimension].score) * 100) / 100];
  }));
}

function auditMarkdown(audits: TraceAuditV2[]): string {
  const missingToolCases = audits.filter((entry) => entry.expectedToolMissing);
  const argumentCases = audits.filter((entry) => entry.argumentMutations.length);
  const normalizationCases = audits.filter((entry) => entry.argumentMutations.some((item) => item.classification === 'normalization_candidate'));
  const semanticArgumentCases = audits.filter((entry) => entry.argumentMutations.some((item) => item.classification === 'semantic_mismatch'));
  const hallucinationCases = audits.filter((entry) => entry.unsupportedFacts.length);
  const requiredEvidenceCases = audits.filter((entry) => entry.requiredEvidenceMismatches.length);
  const evidenceCases = audits.filter((entry) => entry.evidenceIssues.length);
  const refusalCases = audits.filter((entry) => !entry.refusal.priorityCorrect);
  const details = audits.filter((entry) => entry.expectedToolMissing || entry.argumentMutations.length || entry.unsupportedFacts.length || entry.requiredEvidenceMismatches.length || entry.evidenceIssues.length || !entry.refusal.priorityCorrect)
    .map((entry) => {
      const issues = [
        ...(entry.expectedToolMissing ? ['期望工具未调用'] : []),
        ...entry.argumentMutations.map((item) => `${item.classification === 'normalization_candidate' ? '待契约确认的名称规范化' : '参数语义不匹配'} ${item.field}: ${JSON.stringify(item.expected)} → ${JSON.stringify(item.actual)}`),
        ...entry.unsupportedFacts.map((fact) => `无工具支撑事实 ${fact.key}=${JSON.stringify(fact.value)}`),
        ...entry.requiredEvidenceMismatches.map((key) => `必需证据缺失或被改写: ${key}`),
        ...entry.evidenceIssues,
        ...(!entry.refusal.priorityCorrect ? [`拒绝优先级: 期望 ${entry.refusal.expected}，实际 ${entry.refusal.actual ?? '缺失'}`] : []),
      ];
      return `| ${entry.caseId} | ${issues.join('<br>')} |`;
    }).join('\n');
  return `# DeepSeek 既有 30 条 trace 离线真实错误审核\n\n`
    + `本报告只读取 Session 9 已保存的 \`traces.json\`，未调用模型、Market 或其他 API。\n\n`
    + `- 期望工具未调用：${missingToolCases.length} 条\n`
    + `- 存在参数逐字差异：${argumentCases.length} 条（不能直接等同于改变用户原意）\n`
    + `- 其中待契约确认的名称规范化：${normalizationCases.length} 条\n`
    + `- 至少包含一项真实语义不匹配：${semanticArgumentCases.length} 条\n`
    + `- 存在工具结果不支持的额外事实：${hallucinationCases.length} 条\n`
    + `- 必需证据缺失或被改写：${requiredEvidenceCases.length} 条\n`
    + `- 已提交证据的时间、范围或来源异常：${evidenceCases.length} 条\n`
    + `- 权限拒绝原因优先级错误：${refusalCases.length} 条\n\n`
    + `## 逐条问题\n\n| Case | 审核结论 |\n|---|---|\n${details || '| — | 未发现 |'}\n`;
}

const [v1Remote, remoteTraces, desktopTraces] = await Promise.all([
  json<EvalSummary>(resolve(experimentReports, 'baseline.json')),
  json<AgentTrace[]>(resolve(experimentReports, 'traces.json')),
  json<AgentTrace[]>(resolve(packageRoot, 'reports', 'desktop-harness-traces.json')),
]);

const v2CaseIds = new Set(V2_AGENT_EVAL_CASES.map((entry) => entry.id));
const legacyCases = FIRST_AGENT_EVAL_CASES.filter((entry) => v2CaseIds.has(entry.id));
const legacyRemoteTraces = remoteTraces.filter((entry) => v2CaseIds.has(entry.caseId));
const legacyDesktopTraces = desktopTraces.filter((entry) => v2CaseIds.has(entry.caseId));
const v1Desktop = evaluateAgentTraces(legacyCases, legacyDesktopTraces, {
  candidate: 'desktop-deterministic-harness-original-30', generatedAt: GENERATED_AT,
});

const remoteV2 = evaluateAgentTracesV2(V2_AGENT_EVAL_CASES, legacyRemoteTraces, {
  candidate: 'dsh-deepseek-v4-flash-existing-traces', generatedAt: GENERATED_AT, latencyClass: 'remote_model',
});
const desktopV2 = evaluateAgentTracesV2(V2_AGENT_EVAL_CASES, legacyDesktopTraces, {
  candidate: 'desktop-deterministic-harness-existing-traces', generatedAt: GENERATED_AT, latencyClass: 'local_harness',
});
const audits = auditAgentTracesV2(V2_AGENT_EVAL_CASES, legacyRemoteTraces);
const comparison = {
  schemaVersion: '2.0', suiteId: 'warframe-companion-agent-eval-v2', generatedAt: GENERATED_AT,
  execution: 'offline_saved_traces_only', apiCalls: 0,
  remoteModel: {
    candidate: remoteV2.candidate,
    v1: { suiteId: v1Remote.suiteId, passedCases: v1Remote.passedCases, score: v1Remote.score, dimensionScores: v1Remote.dimensionScores },
    v2: { passedCases: remoteV2.passedCases, score: remoteV2.score, dimensionScores: remoteV2.dimensionScores, safetyGateScores: remoteV2.safetyGateScores, latency: remoteV2.latency },
    delta: { score: Math.round((remoteV2.score - v1Remote.score) * 100) / 100, dimensions: metricDelta(v1Remote, remoteV2) },
  },
  localHarness: {
    candidate: desktopV2.candidate,
    v1: { suiteId: v1Desktop.suiteId, passedCases: v1Desktop.passedCases, score: v1Desktop.score, dimensionScores: v1Desktop.dimensionScores },
    v2: { passedCases: desktopV2.passedCases, score: desktopV2.score, dimensionScores: desktopV2.dimensionScores, safetyGateScores: desktopV2.safetyGateScores, latency: desktopV2.latency },
    delta: { score: Math.round((desktopV2.score - v1Desktop.score) * 100) / 100, dimensions: metricDelta(v1Desktop, desktopV2) },
  },
  scoreChangeSources: [
    '工具调用后的 answer 终态不再与 call_tool 人为冲突，但仍要求期望工具真实出现。',
    '合理且可由工具 fixture 支持的额外事实不再使事实维度失败；无支撑额外事实仍被独立安全门禁拒绝。',
    '远程模型使用独立 15000ms 完整 case 预算；桌面 Harness 继续使用 v1 本地预算。',
    '参数精确落地、必需事实、证据精确匹配和权限拒绝优先级均未放宽。',
    '参数指标仍是逐字结构比较；名称规范化候选与真实 rank/platform/crossplay 漂移已在审核报告分开，不把该指标当作模型或 Harness 选型结论。',
  ],
};
const dimensionRows = Object.keys(remoteV2.dimensionScores).map((key) => {
  const dimension = key as keyof EvalSummary['dimensionScores'];
  const before = v1Remote.dimensionScores[dimension].score;
  const after = remoteV2.dimensionScores[dimension].score;
  return `| ${key} | ${before.toFixed(2)}% | ${after.toFixed(2)}% | ${(after - before).toFixed(2)}pp |`;
}).join('\n');
const comparisonMarkdown = `# Agent eval v1 / v2 离线对比\n\n`
  + `> 定位：这是 DSH 集成冒烟与评分协议演进记录，不是 OpenClaw/DSH 或模型优劣比较，也不是 Companion Harness 选型依据。\n\n`
  + `- 执行方式：只读取既有 trace，API 调用 **0**\n`
  + `- v1 DeepSeek 历史基线保持：**${v1Remote.passedCases}/${v1Remote.caseCount}、${v1Remote.score.toFixed(2)}%**\n`
  + `- v2 DeepSeek 离线重评：**${remoteV2.passedCases}/${remoteV2.caseCount}、${remoteV2.score.toFixed(2)}%**\n`
  + `- v1 桌面 Harness：**${v1Desktop.passedCases}/${v1Desktop.caseCount}、${v1Desktop.score.toFixed(2)}%**\n`
  + `- v2 桌面 Harness 离线重评：**${desktopV2.passedCases}/${desktopV2.caseCount}、${desktopV2.score.toFixed(2)}%**\n\n`
  + `## 分数变化来源\n\n${comparison.scoreChangeSources.map((entry) => `- ${entry}`).join('\n')}\n\n`
  + `## DeepSeek 同一输出的指标变化\n\n| 指标 | v1 | v2 | 变化 |\n|---|---:|---:|---:|\n${dimensionRows}\n\n`
  + `## 延迟分离\n\n`
  + `| 候选 | 类别 | min | median | p95 | max |\n|---|---|---:|---:|---:|---:|\n`
  + `| 桌面确定性 Harness | ${desktopV2.latency.class} | ${desktopV2.latency.minimumMs}ms | ${desktopV2.latency.medianMs}ms | ${desktopV2.latency.p95Ms}ms | ${desktopV2.latency.maximumMs}ms |\n`
  + `| DSH / DeepSeek | ${remoteV2.latency.class} | ${remoteV2.latency.minimumMs}ms | ${remoteV2.latency.medianMs}ms | ${remoteV2.latency.p95Ms}ms | ${remoteV2.latency.maximumMs}ms |\n`;

await mkdir(reportsRoot, { recursive: true });
await Promise.all([
  writeFile(resolve(reportsRoot, 'deepseek-existing-traces-baseline.json'), `${JSON.stringify(remoteV2, null, 2)}\n`, 'utf8'),
  writeFile(resolve(reportsRoot, 'deepseek-existing-traces-baseline.md'), renderMarkdownReportV2(remoteV2), 'utf8'),
  writeFile(resolve(reportsRoot, 'desktop-existing-traces-baseline.json'), `${JSON.stringify(desktopV2, null, 2)}\n`, 'utf8'),
  writeFile(resolve(reportsRoot, 'desktop-existing-traces-baseline.md'), renderMarkdownReportV2(desktopV2), 'utf8'),
  writeFile(resolve(reportsRoot, 'v1-v2-comparison.json'), `${JSON.stringify(comparison, null, 2)}\n`, 'utf8'),
  writeFile(resolve(reportsRoot, 'v1-v2-comparison.md'), comparisonMarkdown, 'utf8'),
  writeFile(resolve(reportsRoot, 'deepseek-trace-audit.json'), `${JSON.stringify(audits, null, 2)}\n`, 'utf8'),
  writeFile(resolve(reportsRoot, 'deepseek-trace-audit.md'), auditMarkdown(audits), 'utf8'),
]);
process.stdout.write(`Offline v2 re-score: DeepSeek ${remoteV2.passedCases}/${remoteV2.caseCount}, ${remoteV2.score.toFixed(2)}%; desktop ${desktopV2.passedCases}/${desktopV2.caseCount}, ${desktopV2.score.toFixed(2)}%; API calls 0.\n`);
