import type { AgentEvalCase, AgentTrace } from './index.js';

/**
 * Contract oracle used to validate the evaluator and establish a reproducible
 * upper-bound baseline. It is not a model or production Agent measurement.
 */
export function createReferenceTrace(testCase: AgentEvalCase): AgentTrace {
  const expected = testCase.expected;
  return {
    caseId: testCase.id,
    decision: expected.decision,
    toolCalls: expected.toolName && expected.arguments
      ? [{ name: expected.toolName, arguments: structuredClone(expected.arguments) }]
      : [],
    facts: structuredClone(expected.facts ?? []),
    ...(expected.refusalReason ? { refusalReason: expected.refusalReason } : {}),
    latencyMs: expected.decision === 'call_tool' ? 250 : 25,
  };
}
