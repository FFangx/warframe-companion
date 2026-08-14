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
import type { DropSearchResult } from '@warframe-companion/warframe-data-service';

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

export function createSyntheticMarketResult(testCase: AgentEvalCase): MarketQueryResult {
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
export function createSyntheticDropResult(testCase: AgentEvalCase): DropSearchResult {
  const evidence = testCase.expected.facts?.find((entry) => entry.evidence)?.evidence;
  return testCase.id === 'drops-failure-002' ? {
    contractVersion: '1.1', ok: false,
    error: { code: 'SOURCE_UNAVAILABLE', message: '合成公共掉落源不可用。', retryable: true },
  } : testCase.id === 'drops-failure-001' ? {
    contractVersion: '1.1', ok: false,
    error: { code: 'SOURCE_TOO_OLD', message: '合成公共掉落源过旧。', retryable: true },
    evidence: evidence as NonNullable<Extract<DropSearchResult, { ok: false }>['evidence']>,
  } : {
    contractVersion: '1.1', ok: true,
    data: {
      requestedItem: String(testCase.expected.arguments?.item), resolvedItem: 'Synthetic Drop Item', match: 'exact', totalDrops: 3,
      drops: [{ place: 'Synthetic Node (Rotation C)', chance: 12.5, rarity: 'Rare' }],
    },
    evidence: (evidence ?? {
      scope: 'static_drop_table', evidenceType: 'versioned_public_snapshot', asOf: '2030-01-01T00:00:00.000Z',
      loadedAt: '2030-01-02T03:00:00.000Z', expiresAt: '2030-01-02T03:09:05.000Z', freshness: 'fresh', cacheFreshness: 'fresh',
      sourceAge: { ageMs: 97_445_000, status: 'current', warningAfterMs: 2_592_000_000, rejectAfterMs: 7_776_000_000 },
      finding: 'confirmed_present', source: 'wfcd.drop-data', sourceHash: 'synthetic-drop-hash', selectedEndpoint: 'wfcd.jsdelivr',
      alternativeComparison: { checkedAt: '2030-01-02T03:00:00.000Z', status: 'matched', preferred: 'primary', reason: 'same_hash', primaryHash: 'synthetic-primary', alternativeHash: 'synthetic-primary' },
    }) as Extract<DropSearchResult, { ok: true }>['evidence'],
    warnings: [],
  };
}
export function createSyntheticMarketResultForCase(testCase: AgentEvalCase): MarketQueryResult {
  if (testCase.category === 'evidence') return createSyntheticMarketResult(testCase);
  if (testCase.category === 'failure-degradation') return structuredClone(FAILURE_BY_ID[testCase.id]!);
  return structuredClone(MOCK_MARKET_QUERY_SUCCESS);
}

export async function createDesktopHarnessTrace(testCase: AgentEvalCase): Promise<AgentTrace> {
  const syntheticLatencyMs = testCase.expected.decision === 'call_tool' ? 2 : 1;
  let clockCalls = 0;
  const syntheticNow = () => clockCalls++ === 0 ? 0 : syntheticLatencyMs;
  const isDrop = testCase.id.startsWith('drops-');
  if (isDrop) {
    const result = createSyntheticDropResult(testCase);
    const run = await runDesktopAgent({ requestId: testCase.id, message: testCase.prompt, context: testCase.context }, {
      marketQuery: async () => { throw new Error('market.query must not be called for drop eval'); },
      searchDrops: async () => result, now: syntheticNow,
    });
    return run.trace;
  }
  const isEvidence = testCase.category === 'evidence';
  const isFailure = testCase.category === 'failure-degradation';
  const result = createSyntheticMarketResultForCase(testCase);
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
  }, { marketQuery: async () => result, now: syntheticNow });
  return run.trace;
}
