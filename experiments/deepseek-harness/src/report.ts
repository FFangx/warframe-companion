import type { AgentTrace } from './types.js';

interface SummaryLike {
  candidate: string;
  caseCount: number;
  passedCases: number;
  score: number;
}

export interface ComparisonReport {
  schemaVersion: '1.0';
  status: 'completed' | 'blocked_no_credential';
  generatedAt: string;
  suiteId: 'warframe-companion-agent-eval-v1';
  fixturePolicy: 'synthetic_market_only';
  latencyPolicy: 'real_wall_clock_same_machine';
  dsh: {
    commit: string;
    version: string;
    provider: string;
    model: string;
    baseUrlClass: string;
  };
  candidates: Array<SummaryLike | { candidate: string; status: string }>;
  limitations: string[];
  traces?: AgentTrace[];
}

export function renderComparisonMarkdown(report: ComparisonReport): string {
  const rows = report.candidates.map((entry) => 'score' in entry
    ? `| ${entry.candidate} | ${entry.passedCases}/${entry.caseCount} | ${entry.score.toFixed(2)}% | completed |`
    : `| ${entry.candidate} | — | — | ${entry.status} |`).join('\n');
  return `# DSH / DeepSeek Agent eval 对比\n\n`
    + `- 状态：\`${report.status}\`\n`
    + `- 生成时间：${report.generatedAt}\n`
    + `- DSH commit：\`${report.dsh.commit}\`\n`
    + `- DSH version：\`${report.dsh.version}\`\n`
    + `- Provider / model：\`${report.dsh.provider}\` / \`${report.dsh.model}\`\n`
    + `- Market：合成、脱敏 fixture（不是真实网络行情）\n`
    + `- 延迟：同机完整 case 墙钟时间\n\n`
    + `| Candidate | 通过 | 得分 | 状态 |\n|---|---:|---:|---|\n${rows}\n\n`
    + `## 边界\n\n${report.limitations.map((entry) => `- ${entry}`).join('\n')}\n`;
}
