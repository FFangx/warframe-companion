import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runDshCase } from './dsh-driver.js';
import { createSyntheticMarketFixture } from './fixtures.js';
import { renderComparisonMarkdown, type ComparisonReport } from './report.js';
import type { AgentEvalCase, AgentTrace } from './types.js';

const execFileAsync = promisify(execFile);
const experimentRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const companionRoot = resolve(experimentRoot, '..', '..');
const dshRoot = resolve(companionRoot, '..', 'deepseek-harness');
const reportsRoot = resolve(experimentRoot, 'reports');
const expectedCommit = '47f943859bef60e4160492346772ded9b24f765a';

async function jsonFile(path: string): Promise<any> { return JSON.parse(await readFile(path, 'utf8')); }
async function moduleAt(path: string): Promise<any> { return import(pathToFileURL(path).href); }

const [{ stdout: commitOut }, dshPackage] = await Promise.all([
  execFileAsync('git', ['-C', dshRoot, 'rev-parse', 'HEAD']),
  jsonFile(resolve(dshRoot, 'package.json')),
]);
const commit = commitOut.trim();
if (commit !== expectedCommit) throw new Error(`DSH commit mismatch: expected ${expectedCommit}, got ${commit}`);

const evalModule = await moduleAt(resolve(companionRoot, 'packages', 'agent-eval', 'dist', 'index.js'));
const mockModule = await moduleAt(resolve(companionRoot, 'packages', 'market-query-contract', 'dist', 'mock-fixtures.js'));
const cases = evalModule.FIRST_AGENT_EVAL_CASES as AgentEvalCase[];
const generatedAt = new Date().toISOString();
const reference = await jsonFile(resolve(companionRoot, 'packages', 'agent-eval', 'reports', 'baseline.json'));
const desktop = await jsonFile(resolve(companionRoot, 'packages', 'agent-eval', 'reports', 'desktop-harness-baseline.json'));
const compact = (summary: any) => ({
  candidate: String(summary.candidate),
  caseCount: Number(summary.caseCount),
  passedCases: Number(summary.passedCases),
  score: Number(summary.score),
});
const identity = {
  commit,
  version: String(dshPackage.version),
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  baseUrlClass: process.env.DEEPSEEK_BASE_URL ? 'configured_override' : 'official_default',
};

await mkdir(reportsRoot, { recursive: true });
if (!process.env.DEEPSEEK_API_KEY?.trim()) {
  const blocked: ComparisonReport = {
    schemaVersion: '1.0', status: 'blocked_no_credential', generatedAt,
    suiteId: 'warframe-companion-agent-eval-v1', fixturePolicy: 'synthetic_market_only',
    latencyPolicy: 'real_wall_clock_same_machine', dsh: identity,
    candidates: [compact(reference), compact(desktop), { candidate: 'dsh-deepseek-v4-flash', status: 'blocked_no_credential' }],
    limitations: [
      '未发现 DEEPSEEK_API_KEY；本次没有发起模型请求，也没有生成或伪造模型轨迹。',
      '插件、门禁和事件适配器可通过 keyless 测试验收；真实 30 条成绩需在凭据可用后运行相同命令。',
      '参考 oracle 与桌面确定性 Harness 的既有成绩仅作横向位置说明。',
    ],
  };
  await writeFile(resolve(reportsRoot, 'comparison.json'), `${JSON.stringify(blocked, null, 2)}\n`, 'utf8');
  await writeFile(resolve(reportsRoot, 'comparison.md'), renderComparisonMarkdown(blocked), 'utf8');
  process.stdout.write('DSH/DeepSeek eval blocked: DEEPSEEK_API_KEY is not configured. No model request was made.\n');
  process.exitCode = 2;
} else {
  const traces: AgentTrace[] = [];
  for (const testCase of cases) {
    process.stdout.write(`Running ${testCase.id}...\n`);
    traces.push(await runDshCase({
      dshRoot,
      testCase,
      marketFixture: createSyntheticMarketFixture(testCase, mockModule),
    }));
  }
  const summary = evalModule.evaluateAgentTraces(cases, traces, {
    candidate: 'dsh-deepseek-v4-flash', generatedAt,
  });
  summary.limitations = [
    '模型推理为真实 DeepSeek provider 请求；Market 工具响应为合成、脱敏 fixture，不是真实网络行情。',
    'latencyMs 是同一台机器上每个完整 case 的墙钟耗时；既有桌面报告使用本地确定性延迟，不能直接作模型性能结论。',
    '工具调用来自持久 session/event，结果来自只读 tools/result，模型只通过终态 schema 提交 decision/facts/refusalReason。',
  ];
  const completed: ComparisonReport = {
    schemaVersion: '1.0', status: 'completed', generatedAt,
    suiteId: 'warframe-companion-agent-eval-v1', fixturePolicy: 'synthetic_market_only',
    latencyPolicy: 'real_wall_clock_same_machine', dsh: identity,
    candidates: [compact(reference), compact(desktop), compact(summary)], limitations: summary.limitations, traces,
  };
  await writeFile(resolve(reportsRoot, 'traces.json'), `${JSON.stringify(traces, null, 2)}\n`, 'utf8');
  await writeFile(resolve(reportsRoot, 'baseline.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await writeFile(resolve(reportsRoot, 'baseline.md'), evalModule.renderMarkdownReport(summary), 'utf8');
  await writeFile(resolve(reportsRoot, 'comparison.json'), `${JSON.stringify(completed, null, 2)}\n`, 'utf8');
  await writeFile(resolve(reportsRoot, 'comparison.md'), renderComparisonMarkdown(completed), 'utf8');
  process.stdout.write(`DSH/DeepSeek eval: ${summary.passedCases}/${summary.caseCount}, ${summary.score.toFixed(2)}%\n`);
}
