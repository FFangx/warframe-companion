import type { MarketQueryFailure, MarketQueryRequest, MarketQuerySuccess } from './index.js';

export const MOCK_MARKET_QUERY_REQUEST = {
  contractVersion: '1.0',
  item: '示例 Prime 蓝图',
  platform: 'pc',
  crossplay: true,
  rank: 0,
} as const satisfies MarketQueryRequest;

const evidence = {
  scope: 'current_market',
  evidenceType: 'direct_snapshot',
  asOf: '2030-01-02T03:04:05.000Z',
  expiresAt: '2030-01-02T03:09:05.000Z',
  freshness: 'fresh',
  source: 'warframe.market',
} as const;

const item = {
  slug: 'example_prime_blueprint',
  name: { en: 'Example Prime Blueprint', zhHans: '示例 Prime 蓝图' },
  tags: ['prime', 'blueprint'] as string[],
  rank: { requested: 0, resolved: 0, maxRank: 0 },
  ducats: 45,
  tradingTax: 4000,
  masteryRank: null,
} as const;

export const MOCK_MARKET_QUERY_SUCCESS = {
  contractVersion: '1.0',
  ok: true,
  data: {
    requestedItem: '示例 Prime 蓝图',
    item,
    sellOrders: [{
      side: 'sell', platinum: 12, quantity: 2, ingameName: 'SyntheticTennoA', status: 'ingame',
      platform: 'pc', crossplay: true, rank: null, updatedAt: '2030-01-02T03:03:00.000Z',
    }],
    buyOrders: [{
      side: 'buy', platinum: 9, quantity: 1, ingameName: 'SyntheticTennoB', status: 'online',
      platform: 'pc', crossplay: true, rank: null, updatedAt: '2030-01-02T03:02:00.000Z',
    }],
    statistics: {
      basis: 'closed_trades_90_days', median: 10, dailyVolume: 3.2, sampleSize: 288, rank: 0,
      asOf: '2030-01-02T03:04:05.000Z',
    },
  },
  evidence: { ...evidence, finding: 'confirmed_present' },
  warnings: [],
} as const satisfies MarketQuerySuccess;

export const MOCK_MARKET_QUERY_NO_ORDERS = {
  contractVersion: '1.0',
  ok: true,
  data: {
    requestedItem: '示例 Prime 蓝图', item, sellOrders: [], buyOrders: [],
  },
  evidence: { ...evidence, finding: 'confirmed_absent_in_scope' },
  warnings: [
    { code: 'NO_SELL_ORDERS', message: '本次快照没有可见卖单。' },
    { code: 'NO_BUY_ORDERS', message: '本次快照没有可见买单。' },
    { code: 'STATISTICS_UNAVAILABLE', message: '成交统计不可用，当前订单查询仍然成功。' },
  ],
} as const satisfies MarketQuerySuccess;

function failure(error: MarketQueryFailure['error'], includeEvidence = false): MarketQueryFailure {
  return {
    contractVersion: '1.0',
    ok: false,
    error,
    ...(includeEvidence ? { evidence: { ...evidence, finding: 'unavailable' } } : {}),
  };
}

export const MOCK_MARKET_QUERY_FAILURES = {
  invalidRequest: failure({ category: 'validation', code: 'INVALID_REQUEST', message: '请求缺少必填字段。', retryable: false, details: { field: 'item' } }),
  unsupportedPlatform: failure({ category: 'validation', code: 'UNSUPPORTED_PLATFORM', message: '平台不受支持。', retryable: false, details: { field: 'platform' } }),
  invalidRank: failure({ category: 'validation', code: 'INVALID_RANK', message: '等级超出物品范围。', retryable: false, details: { field: 'rank' } }),
  notFound: failure({ category: 'resolution', code: 'ITEM_NOT_FOUND', message: '没有找到匹配物品。', retryable: false }),
  ambiguous: failure({
    category: 'resolution', code: 'ITEM_AMBIGUOUS', message: '物品名称对应多个候选项。', retryable: false,
    details: { candidates: [
      { slug: 'example_prime_set', name: { en: 'Example Prime Set', zhHans: '示例 Prime 套装' } },
      { slug: 'example_prime_blueprint', name: { en: 'Example Prime Blueprint', zhHans: '示例 Prime 蓝图' } },
    ] },
  }),
  unavailable: failure({ category: 'upstream', code: 'UPSTREAM_UNAVAILABLE', message: '市场数据源暂时不可用。', retryable: true }, true),
  timeout: failure({ category: 'upstream', code: 'UPSTREAM_TIMEOUT', message: '市场数据源响应超时。', retryable: true }, true),
  rateLimited: failure({ category: 'upstream', code: 'UPSTREAM_RATE_LIMITED', message: '市场数据源请求过于频繁。', retryable: true, details: { retryAfterMs: 30000 } }, true),
  badResponse: failure({ category: 'upstream', code: 'UPSTREAM_BAD_RESPONSE', message: '市场数据源返回了无法解析的数据。', retryable: false }, true),
  internal: failure({ category: 'internal', code: 'INTERNAL_ERROR', message: '市场查询内部失败。', retryable: false }),
} as const satisfies Record<string, MarketQueryFailure>;

export const MOCK_MARKET_QUERY_RESULTS = [
  MOCK_MARKET_QUERY_SUCCESS,
  MOCK_MARKET_QUERY_NO_ORDERS,
  ...Object.values(MOCK_MARKET_QUERY_FAILURES),
] as const;
