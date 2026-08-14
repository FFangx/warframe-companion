export const AGENT_EVAL_SCHEMA_VERSION = '1.0' as const;

export type EvalCategory = 'tool-routing' | 'evidence' | 'failure-degradation' | 'permission';
export type AgentDecision = 'call_tool' | 'clarify' | 'answer' | 'refuse';
export type RefusalReason = 'identity_untrusted' | 'private_scope' | 'write_forbidden';

export interface EvalContext {
  channel: 'desktop' | 'qq_private' | 'qq_group' | 'untrusted_test';
  trustedOwner: boolean;
  now: string;
}

export interface EvalEvidence {
  scope: 'current_market' | 'personal_snapshot';
  evidenceType: 'direct_snapshot' | 'local_snapshot';
  asOf: string;
  expiresAt: string;
  freshness: 'fresh' | 'stale';
  finding: 'confirmed_present' | 'confirmed_absent_in_scope' | 'unavailable';
  source: 'warframe.market' | 'synthetic.local';
}

export interface EvalFact {
  key: string;
  value: string | number | boolean;
  evidence?: EvalEvidence;
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

export interface ToolCallTrace {
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentTrace {
  caseId: string;
  decision: AgentDecision;
  toolCalls: ToolCallTrace[];
  facts: EvalFact[];
  refusalReason?: RefusalReason;
  latencyMs: number;
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

export { FIRST_AGENT_EVAL_CASES } from './cases.js';
export { createReferenceTrace } from './reference-baseline.js';
export { evaluateAgentTraces, renderMarkdownReport } from './runner.js';
