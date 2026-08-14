import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FIRST_AGENT_EVAL_CASES } from './cases.js';
import { createReferenceTrace } from './reference-baseline.js';
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
process.stdout.write(`Agent eval: ${summary.passedCases}/${summary.caseCount}, ${summary.score.toFixed(2)}%\n`);
