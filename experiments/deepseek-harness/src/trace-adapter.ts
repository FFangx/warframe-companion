import { DSH_SUBMIT_TOOL, DSH_TO_LOGICAL } from './plugin.js';
import type { AgentTrace, SessionEventLike, ToolResultObservation, TraceSubmission } from './types.js';

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseArguments(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') return {};
  try { return record(JSON.parse(raw)) ?? {}; } catch { return {}; }
}

export function createAgentTraceFromDsh(options: {
  caseId: string;
  events: readonly SessionEventLike[];
  toolResults: readonly ToolResultObservation[];
  submission: TraceSubmission | undefined;
  startedAt: number;
  finishedAt: number;
}): AgentTrace {
  const toolCalls = options.events.flatMap((event) => {
    if (event.type !== 'tool/call') return [];
    const data = event.data ?? {};
    const dshName = typeof data.name === 'string' ? data.name : '';
    if (!dshName || dshName === DSH_SUBMIT_TOOL) return [];
    return [{ name: DSH_TO_LOGICAL[dshName] ?? dshName, arguments: parseArguments(data.arguments) }];
  });
  const submission = options.submission;
  const trace: AgentTrace = {
    caseId: options.caseId,
    decision: submission?.decision ?? 'answer',
    toolCalls,
    facts: structuredClone(submission?.facts ?? []),
    latencyMs: Math.max(0, options.finishedAt - options.startedAt),
  };
  if (submission?.refusalReason) trace.refusalReason = submission.refusalReason;
  return trace;
}

export function observeToolResult(execution: unknown, result: unknown): ToolResultObservation | undefined {
  const exec = record(execution);
  const outcome = record(result);
  if (!exec || !outcome || typeof exec.name !== 'string') return undefined;
  return {
    name: DSH_TO_LOGICAL[exec.name] ?? exec.name,
    arguments: record(exec.arguments) ?? {},
    isError: outcome.isError === true,
    ...(outcome.isError === false ? { value: structuredClone(outcome.value) } : {}),
  };
}

export function assertSubmissionConsistent(trace: AgentTrace, toolResults: readonly ToolResultObservation[]): void {
  const businessResults = toolResults.filter((entry) => entry.name !== DSH_SUBMIT_TOOL);
  if (trace.toolCalls.length !== businessResults.length) {
    throw new TypeError('Durable tool calls and final tool results do not match');
  }
  if (trace.decision === 'call_tool' && trace.toolCalls.length === 0) {
    throw new TypeError('call_tool decision requires an authoritative business tool call');
  }
  if (trace.decision === 'refuse' && !trace.refusalReason) {
    throw new TypeError('refuse decision requires refusalReason');
  }
}
