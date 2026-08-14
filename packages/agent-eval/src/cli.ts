import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FIRST_AGENT_EVAL_CASES } from './cases.js';
import { createReferenceTrace } from './reference-baseline.js';
import { createDesktopHarnessTrace } from './desktop-harness-baseline.js';
import { createOpenAICompatibleMockTrace } from './openai-compatible-mock-baseline.js';
import { evaluateAgentTraces, renderMarkdownReport } from './runner.js';

const GENERATED_AT = '2026-08-14T00:00:00.000Z';
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reportDirectory = resolve(packageRoot, 'reports');
const traces = FIRST_AGENT_EVAL_CASES.map(createReferenceTrace);
const summary = evaluateAgentTraces(FIRST_AGENT_EVAL_CASES, traces, {
  candidate: 'reference-contract-oracle',
  generatedAt: GENERATED_AT,
});

await mkdir(reportDirectory, { recursive: true });
await writeFile(resolve(reportDirectory, 'baseline.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
await writeFile(resolve(reportDirectory, 'baseline.md'), renderMarkdownReport(summary), 'utf8');
const desktopTraces = await Promise.all(FIRST_AGENT_EVAL_CASES.map(createDesktopHarnessTrace));
const desktopSummary = evaluateAgentTraces(FIRST_AGENT_EVAL_CASES, desktopTraces, {
  candidate: 'desktop-deterministic-harness-v1', generatedAt: GENERATED_AT,
});
desktopSummary.limitations = [
  '本报告来自桌面生产 Agent Runtime 的真实编排路径，不是复制 expected 的参考 oracle。',
  '当前候选是确定性 Harness，不包含 LLM、OpenClaw 或 DeepSeek 模型推理。',
  '评估工具响应为合成夹具；延迟只覆盖本地编排，不代表真实网络延迟。',
];
await writeFile(resolve(reportDirectory, 'desktop-harness-traces.json'), `${JSON.stringify(desktopTraces, null, 2)}\n`, 'utf8');
await writeFile(resolve(reportDirectory, 'desktop-harness-baseline.json'), `${JSON.stringify(desktopSummary, null, 2)}\n`, 'utf8');
await writeFile(resolve(reportDirectory, 'desktop-harness-baseline.md'), renderMarkdownReport(desktopSummary), 'utf8');
const openAICompatibleTraces = await Promise.all(FIRST_AGENT_EVAL_CASES.map(createOpenAICompatibleMockTrace));
const openAICompatibleSummary = evaluateAgentTraces(FIRST_AGENT_EVAL_CASES, openAICompatibleTraces, {
  candidate: 'openai-compatible-keyless-contract-mock', generatedAt: GENERATED_AT,
});
openAICompatibleSummary.limitations = [
  '本报告使用本地合成 Chat Completions/SSE transport 验证 OpenAI-compatible adapter 与生产 Harness 的合同路径。',
  '它不调用远程或付费模型，不衡量任何真实模型质量，也不读取凭据。',
  '工具响应、身份、时间和事实全部为合成夹具；延迟只覆盖本地编排。',
];
await writeFile(resolve(reportDirectory, 'openai-compatible-mock-traces.json'), `${JSON.stringify(openAICompatibleTraces, null, 2)}\n`, 'utf8');
await writeFile(resolve(reportDirectory, 'openai-compatible-mock-baseline.json'), `${JSON.stringify(openAICompatibleSummary, null, 2)}\n`, 'utf8');
await writeFile(resolve(reportDirectory, 'openai-compatible-mock-baseline.md'), renderMarkdownReport(openAICompatibleSummary), 'utf8');
process.stdout.write(`Reference eval: ${summary.passedCases}/${summary.caseCount}, ${summary.score.toFixed(2)}%\n`);
process.stdout.write(`Desktop Harness eval: ${desktopSummary.passedCases}/${desktopSummary.caseCount}, ${desktopSummary.score.toFixed(2)}%\n`);
process.stdout.write(`OpenAI-compatible mock eval: ${openAICompatibleSummary.passedCases}/${openAICompatibleSummary.caseCount}, ${openAICompatibleSummary.score.toFixed(2)}%\n`);
