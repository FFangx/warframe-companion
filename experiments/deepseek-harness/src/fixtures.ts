import type { AgentEvalCase } from './types.js';

interface MockModule {
  MOCK_MARKET_QUERY_SUCCESS: unknown;
  MOCK_MARKET_QUERY_NO_ORDERS: unknown;
  MOCK_MARKET_QUERY_FAILURES: Record<string, unknown>;
}

const expectedEvidence = {
  scope: 'current_market', evidenceType: 'direct_snapshot', asOf: '2030-01-02T03:04:00.000Z',
  expiresAt: '2030-01-02T03:09:05.000Z', freshness: 'fresh', source: 'warframe.market',
} as const;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected fixture object');
  return value as Record<string, unknown>;
}

function evidenceFixture(testCase: AgentEvalCase, mocks: MockModule): unknown {
  if (testCase.id === 'evidence-002') {
    const result = object(structuredClone(mocks.MOCK_MARKET_QUERY_NO_ORDERS));
    result.evidence = { ...expectedEvidence, finding: 'confirmed_absent_in_scope' };
    return result;
  }
  if (testCase.id === 'evidence-003') {
    const result = object(structuredClone(mocks.MOCK_MARKET_QUERY_FAILURES.unavailable));
    result.evidence = { ...expectedEvidence, finding: 'unavailable' };
    return result;
  }
  const result = object(structuredClone(mocks.MOCK_MARKET_QUERY_SUCCESS));
  result.evidence = {
    ...expectedEvidence,
    finding: 'confirmed_present',
    ...(testCase.id === 'evidence-004'
      ? { freshness: 'stale', expiresAt: '2030-01-02T02:59:05.000Z' }
      : {}),
  };
  const data = object(result.data);
  if (testCase.id === 'evidence-005') delete data.statistics;
  if (testCase.id === 'evidence-006') data.buyOrders = [];
  return result;
}

const FAILURE_FIXTURE_BY_ID: Record<string, string> = {
  'failure-001': 'timeout',
  'failure-002': 'rateLimited',
  'failure-003': 'badResponse',
  'failure-004': 'notFound',
  'failure-005': 'ambiguous',
  'failure-006': 'internal',
};

export function createSyntheticMarketFixture(testCase: AgentEvalCase, mocks: MockModule): unknown {
  if (testCase.category === 'evidence') return evidenceFixture(testCase, mocks);
  if (testCase.category === 'failure-degradation') {
    const name = FAILURE_FIXTURE_BY_ID[testCase.id];
    if (!name || !(name in mocks.MOCK_MARKET_QUERY_FAILURES)) throw new TypeError(`Missing failure fixture for ${testCase.id}`);
    return structuredClone(mocks.MOCK_MARKET_QUERY_FAILURES[name]);
  }
  return structuredClone(mocks.MOCK_MARKET_QUERY_SUCCESS);
}
