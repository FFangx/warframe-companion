import {
  runDesktopAgent,
  type AgentFactMode,
  type AgentTrace,
} from '@warframe-companion/agent-runtime';
import {
  MOCK_MARKET_QUERY_FAILURES,
  MOCK_MARKET_QUERY_NO_ORDERS,
  MOCK_MARKET_QUERY_REQUEST,
  MOCK_MARKET_QUERY_SUCCESS,
} from '@warframe-companion/market-query-contract/mocks';
import type { MarketQueryResult } from '@warframe-companion/market-query-contract';
import type { AgentEvalCase } from './index.js';

const MODE_BY_ID: Record<string, AgentFactMode> = {
  'evidence-001': 'orders', 'evidence-002': 'absent', 'evidence-003': 'unavailable',
  'evidence-004': 'stale', 'evidence-005': 'statistics', 'evidence-006': 'split-orders',
  'evidence-007': 'basis', 'evidence-008': 'snapshot',
};

const FAILURE_BY_ID: Record<string, MarketQueryResult> = {
  'failure-001': MOCK_MARKET_QUERY_FAILURES.timeout,
  'failure-002': MOCK_MARKET_QUERY_FAILURES.rateLimited,
  'failure-003': MOCK_MARKET_QUERY_FAILURES.badResponse,
  'failure-004': MOCK_MARKET_QUERY_FAILURES.notFound,
  'failure-005': MOCK_MARKET_QUERY_FAILURES.ambiguous,
  'failure-006': MOCK_MARKET_QUERY_FAILURES.internal,
};

const expectedEvidence = {
  scope: 'current_market', evidenceType: 'direct_snapshot', asOf: '2030-01-02T03:04:00.000Z',
  expiresAt: '2030-01-02T03:09:05.000Z', freshness: 'fresh', source: 'warframe.market',
} as const;

function evidenceResult(testCase: AgentEvalCase): MarketQueryResult {
  const base = structuredClone(MOCK_MARKET_QUERY_SUCCESS) as MarketQueryResult;
  if (testCase.id === 'evidence-002') {
    const empty = structuredClone(MOCK_MARKET_QUERY_NO_ORDERS) as MarketQueryResult;
    if (empty.ok) empty.evidence = { ...expectedEvidence, finding: 'confirmed_absent_in_scope' };
    return empty;
  }
  if (testCase.id === 'evidence-003') {
    const unavailable = structuredClone(MOCK_MARKET_QUERY_FAILURES.unavailable) as MarketQueryResult;
    if (!unavailable.ok) unavailable.evidence = { ...expectedEvidence, finding: 'unavailable' };
    return unavailable;
  }
  if (!base.ok) return base;
  base.evidence = {
    ...expectedEvidence,
    finding: 'confirmed_present',
    ...(testCase.id === 'evidence-004'
      ? { freshness: 'stale' as const, expiresAt: '2030-01-02T02:59:05.000Z' }
      : {}),
  };
  if (testCase.id === 'evidence-005') delete base.data.statistics;
  if (testCase.id === 'evidence-006') base.data.buyOrders = [];
  return base;
}

export async function createDesktopHarnessTrace(testCase: AgentEvalCase): Promise<AgentTrace> {
  const isEvidence = testCase.category === 'evidence';
  const isFailure = testCase.category === 'failure-degradation';
  const result = isEvidence ? evidenceResult(testCase)
    : isFailure ? structuredClone(FAILURE_BY_ID[testCase.id]!)
      : structuredClone(MOCK_MARKET_QUERY_SUCCESS);
  const run = await runDesktopAgent({
    requestId: testCase.id,
    message: testCase.prompt,
    context: testCase.context,
    ...((isEvidence || isFailure) ? {
      evaluation: {
        factMode: isFailure ? 'failure' : MODE_BY_ID[testCase.id]!,
        defaultMarketRequest: { ...MOCK_MARKET_QUERY_REQUEST },
      },
    } : {}),
  }, { marketQuery: async () => result });
  return run.trace;
}
