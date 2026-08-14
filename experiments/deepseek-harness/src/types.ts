export type AgentDecision = 'call_tool' | 'clarify' | 'answer' | 'refuse';
export type RefusalReason = 'identity_untrusted' | 'private_scope' | 'write_forbidden';

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

export interface AgentTrace {
  caseId: string;
  decision: AgentDecision;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
  facts: EvalFact[];
  refusalReason?: RefusalReason;
  latencyMs: number;
}

export interface AgentEvalCase {
  id: string;
  category: 'tool-routing' | 'evidence' | 'failure-degradation' | 'permission';
  prompt: string;
  context: {
    channel: 'desktop' | 'qq_private' | 'qq_group' | 'untrusted_test';
    trustedOwner: boolean;
    now: string;
  };
  availableTools: string[];
}

export interface TraceSubmission {
  decision: AgentDecision;
  facts: EvalFact[];
  refusalReason?: RefusalReason;
}

export interface SessionEventLike {
  type: string;
  time?: number;
  data?: Record<string, unknown>;
}

export interface ToolResultObservation {
  name: string;
  arguments: Record<string, unknown>;
  isError: boolean;
  value?: unknown;
}
