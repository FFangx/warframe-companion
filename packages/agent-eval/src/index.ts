export const AGENT_EVAL_SCHEMA_VERSION = '1.0' as const;

export type {
  AgentDecision,
  AgentTrace,
  EvalEvidence,
  EvalFact,
  RefusalReason,
  ToolCallTrace,
} from '@warframe-companion/agent-runtime';
import type { AgentDecision, EvalFact, RefusalReason } from '@warframe-companion/agent-runtime';

export type EvalCategory = 'tool-routing' | 'evidence' | 'failure-degradation' | 'permission';

export interface EvalContext {
  channel: 'desktop' | 'qq_private' | 'qq_group' | 'untrusted_test';
  trustedOwner: boolean;
  now: string;
}

export interface ExpectedTrace {
  decision: AgentDecision;
  toolName?: string;
  arguments?: Record<string, unknown>;
  facts?: EvalFact[];
  forbiddenFactKeys?: string[];
  refusalReason?: RefusalReason;
  maxToolCalls: number;
  latencyBudgetMs: number;
}

export interface AgentEvalCase {
  schemaVersion: typeof AGENT_EVAL_SCHEMA_VERSION;
  id: string;
  category: EvalCategory;
  prompt: string;
  context: EvalContext;
  availableTools: string[];
  expected: ExpectedTrace;
}

export type EvalDimension =
  | 'toolSelection'
  | 'argumentGrounding'
  | 'factCorrectness'
  | 'evidenceCompliance'
  | 'permissionSafety'
  | 'efficiency';

export interface DimensionScore {
  applicable: boolean;
  passed: boolean;
  reason: string;
}

export interface EvalCaseResult {
  caseId: string;
  category: EvalCategory;
  passed: boolean;
  score: number;
  dimensions: Record<EvalDimension, DimensionScore>;
}

export interface EvalSummary {
  schemaVersion: typeof AGENT_EVAL_SCHEMA_VERSION;
  suiteId: 'warframe-companion-agent-eval-v1';
  candidate: string;
  generatedAt: string;
  fixturePolicy: 'synthetic_only';
  caseCount: number;
  passedCases: number;
  failedCases: number;
  score: number;
  categoryCounts: Record<EvalCategory, number>;
  dimensionScores: Record<EvalDimension, { passed: number; applicable: number; score: number }>;
  results: EvalCaseResult[];
  limitations: string[];
}

export { DROP_AGENT_EVAL_CASES, FIRST_AGENT_EVAL_CASES } from './cases.js';
export { createReferenceTrace } from './reference-baseline.js';
export { createDesktopHarnessTrace } from './desktop-harness-baseline.js';
export { evaluateAgentTraces, renderMarkdownReport } from './runner.js';
export {
  AGENT_EVAL_V2_SCHEMA_VERSION,
  AGENT_EVAL_V2_SUITE_ID,
  REMOTE_MODEL_LATENCY_BUDGET_MS,
  V2_AGENT_EVAL_CASES,
  auditAgentTracesV2,
  evaluateAgentTracesV2,
  renderMarkdownReportV2,
  type AgentEvalCaseV2,
  type EvalLatencyClass,
  type EvalSummaryV2,
  type TraceAuditV2,
} from './v2.js';
