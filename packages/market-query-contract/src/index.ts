export const MARKET_QUERY_CONTRACT_VERSION = '1.0' as const;

export const MARKET_PLATFORMS = ['pc', 'ps4', 'xbox', 'switch', 'mobile'] as const;
export type MarketPlatform = (typeof MARKET_PLATFORMS)[number];
export type MarketRank = number | 'max';

export interface MarketQueryRequest {
  contractVersion: typeof MARKET_QUERY_CONTRACT_VERSION;
  item: string;
  platform: MarketPlatform;
  crossplay: boolean;
  rank: MarketRank;
}

export type MarketUserStatus = 'ingame' | 'online' | 'offline' | 'unknown';
export type MarketOrderSide = 'sell' | 'buy';

export interface MarketOrder {
  side: MarketOrderSide;
  platinum: number;
  quantity: number;
  ingameName: string;
  status: MarketUserStatus;
  platform: MarketPlatform;
  crossplay: boolean | null;
  rank: number | null;
  updatedAt: string;
}

export interface ResolvedMarketItem {
  slug: string;
  name: {
    en: string;
    zhHans: string;
  };
  tags: string[];
  rank: {
    requested: MarketRank;
    resolved: number;
    maxRank: number;
  };
  ducats: number | null;
  tradingTax: number | null;
  masteryRank: number | null;
}

export interface ClosedTradeStatistics {
  basis: 'closed_trades_90_days';
  median: number;
  dailyVolume: number;
  sampleSize: number;
  rank: number;
  asOf: string;
}

export type MarketWarningCode =
  | 'NO_SELL_ORDERS'
  | 'NO_BUY_ORDERS'
  | 'STATISTICS_UNAVAILABLE'
  | 'STALE_DATA';

export interface MarketWarning {
  code: MarketWarningCode;
  message: string;
}

export interface MarketEvidence {
  scope: 'current_market';
  evidenceType: 'direct_snapshot';
  asOf: string;
  expiresAt: string;
  freshness: 'fresh' | 'stale';
  finding: 'confirmed_present' | 'confirmed_absent_in_scope' | 'unavailable';
  source: 'warframe.market';
}

export interface MarketQuerySuccess {
  contractVersion: typeof MARKET_QUERY_CONTRACT_VERSION;
  ok: true;
  data: {
    requestedItem: string;
    item: ResolvedMarketItem;
    sellOrders: MarketOrder[];
    buyOrders: MarketOrder[];
    statistics?: ClosedTradeStatistics;
  };
  evidence: MarketEvidence;
  warnings: MarketWarning[];
}

export type MarketQueryErrorCategory =
  | 'validation'
  | 'resolution'
  | 'upstream'
  | 'internal';

export type MarketQueryErrorCode =
  | 'INVALID_REQUEST'
  | 'UNSUPPORTED_PLATFORM'
  | 'INVALID_RANK'
  | 'ITEM_NOT_FOUND'
  | 'ITEM_AMBIGUOUS'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_RATE_LIMITED'
  | 'UPSTREAM_BAD_RESPONSE'
  | 'INTERNAL_ERROR';

export interface MarketQueryErrorDetails {
  field?: 'contractVersion' | 'item' | 'platform' | 'crossplay' | 'rank';
  candidates?: Array<Pick<ResolvedMarketItem, 'slug' | 'name'>>;
  retryAfterMs?: number;
}

export interface MarketQueryFailure {
  contractVersion: typeof MARKET_QUERY_CONTRACT_VERSION;
  ok: false;
  error: {
    category: MarketQueryErrorCategory;
    code: MarketQueryErrorCode;
    message: string;
    retryable: boolean;
    details?: MarketQueryErrorDetails;
  };
  evidence?: MarketEvidence;
}

export type MarketQueryResult = MarketQuerySuccess | MarketQueryFailure;

const ERROR_CATEGORY_BY_CODE: Readonly<Record<MarketQueryErrorCode, MarketQueryErrorCategory>> = {
  INVALID_REQUEST: 'validation',
  UNSUPPORTED_PLATFORM: 'validation',
  INVALID_RANK: 'validation',
  ITEM_NOT_FOUND: 'resolution',
  ITEM_AMBIGUOUS: 'resolution',
  UPSTREAM_UNAVAILABLE: 'upstream',
  UPSTREAM_TIMEOUT: 'upstream',
  UPSTREAM_RATE_LIMITED: 'upstream',
  UPSTREAM_BAD_RESPONSE: 'upstream',
  INTERNAL_ERROR: 'internal',
};

const RETRYABLE_ERROR_CODES = new Set<MarketQueryErrorCode>([
  'UPSTREAM_UNAVAILABLE',
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_RATE_LIMITED',
]);

const WARNING_CODES = new Set<MarketWarningCode>([
  'NO_SELL_ORDERS', 'NO_BUY_ORDERS', 'STATISTICS_UNAVAILABLE', 'STALE_DATA',
]);
const ERROR_CODES = new Set<MarketQueryErrorCode>(Object.keys(ERROR_CATEGORY_BY_CODE) as MarketQueryErrorCode[]);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;

export class MarketContractViolation extends TypeError {
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = 'MarketContractViolation';
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new MarketContractViolation(path, '必须是对象');
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new MarketContractViolation(path, `包含未定义字段：${unexpected.join(', ')}`);
}

function text(value: unknown, path: string, max = 200): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new MarketContractViolation(path, `必须是 1-${max} 字符的非空字符串`);
  }
}

function number(value: unknown, path: string, options: { integer?: boolean; min?: number } = {}): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (options.integer && !Number.isInteger(value)) || (options.min != null && value < options.min)) {
    throw new MarketContractViolation(path, '数值无效');
  }
}

function iso(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !ISO_UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new MarketContractViolation(path, '必须是 UTC ISO-8601 时间');
  }
}

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): asserts value is T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new MarketContractViolation(path, `必须是 ${values.join(' | ')}`);
  }
}

function nullableNumber(value: unknown, path: string): void {
  if (value !== null) number(value, path, { min: 0 });
}

function validateRank(value: unknown, path: string): asserts value is MarketRank {
  if (value === 'max') return;
  number(value, path, { integer: true, min: 0 });
}

function validateName(value: unknown, path: string): void {
  const name = record(value, path);
  exactKeys(name, ['en', 'zhHans'], path);
  text(name.en, `${path}.en`, 120);
  text(name.zhHans, `${path}.zhHans`, 120);
}

function validateResolvedItem(value: unknown, path: string): void {
  const item = record(value, path);
  exactKeys(item, ['slug', 'name', 'tags', 'rank', 'ducats', 'tradingTax', 'masteryRank'], path);
  text(item.slug, `${path}.slug`, 120);
  validateName(item.name, `${path}.name`);
  if (!Array.isArray(item.tags)) throw new MarketContractViolation(`${path}.tags`, '必须是数组');
  item.tags.forEach((tag, index) => text(tag, `${path}.tags[${index}]`, 60));
  const rank = record(item.rank, `${path}.rank`);
  exactKeys(rank, ['requested', 'resolved', 'maxRank'], `${path}.rank`);
  validateRank(rank.requested, `${path}.rank.requested`);
  number(rank.resolved, `${path}.rank.resolved`, { integer: true, min: 0 });
  number(rank.maxRank, `${path}.rank.maxRank`, { integer: true, min: 0 });
  if (rank.resolved > rank.maxRank) throw new MarketContractViolation(`${path}.rank`, 'resolved 不得大于 maxRank');
  nullableNumber(item.ducats, `${path}.ducats`);
  nullableNumber(item.tradingTax, `${path}.tradingTax`);
  nullableNumber(item.masteryRank, `${path}.masteryRank`);
}

function validateOrder(value: unknown, side: MarketOrderSide, path: string): void {
  const order = record(value, path);
  exactKeys(order, ['side', 'platinum', 'quantity', 'ingameName', 'status', 'platform', 'crossplay', 'rank', 'updatedAt'], path);
  if (order.side !== side) throw new MarketContractViolation(`${path}.side`, `必须是 ${side}`);
  number(order.platinum, `${path}.platinum`, { min: 0 });
  number(order.quantity, `${path}.quantity`, { integer: true, min: 1 });
  text(order.ingameName, `${path}.ingameName`, 80);
  enumValue(order.status, ['ingame', 'online', 'offline', 'unknown'], `${path}.status`);
  enumValue(order.platform, MARKET_PLATFORMS, `${path}.platform`);
  if (order.crossplay !== null && typeof order.crossplay !== 'boolean') throw new MarketContractViolation(`${path}.crossplay`, '必须是 boolean 或 null');
  if (order.rank !== null) number(order.rank, `${path}.rank`, { integer: true, min: 0 });
  iso(order.updatedAt, `${path}.updatedAt`);
}

function validateEvidence(value: unknown, path: string): void {
  const evidence = record(value, path);
  exactKeys(evidence, ['scope', 'evidenceType', 'asOf', 'expiresAt', 'freshness', 'finding', 'source'], path);
  if (evidence.scope !== 'current_market') throw new MarketContractViolation(`${path}.scope`, '必须是 current_market');
  if (evidence.evidenceType !== 'direct_snapshot') throw new MarketContractViolation(`${path}.evidenceType`, '必须是 direct_snapshot');
  iso(evidence.asOf, `${path}.asOf`);
  iso(evidence.expiresAt, `${path}.expiresAt`);
  enumValue(evidence.freshness, ['fresh', 'stale'], `${path}.freshness`);
  enumValue(evidence.finding, ['confirmed_present', 'confirmed_absent_in_scope', 'unavailable'], `${path}.finding`);
  if (evidence.source !== 'warframe.market') throw new MarketContractViolation(`${path}.source`, '必须是 warframe.market');
}

export function assertMarketQueryRequest(value: unknown): asserts value is MarketQueryRequest {
  const request = record(value, '$');
  exactKeys(request, ['contractVersion', 'item', 'platform', 'crossplay', 'rank'], '$');
  if (request.contractVersion !== MARKET_QUERY_CONTRACT_VERSION) throw new MarketContractViolation('$.contractVersion', '版本不受支持');
  text(request.item, '$.item', 120);
  enumValue(request.platform, MARKET_PLATFORMS, '$.platform');
  if (typeof request.crossplay !== 'boolean') throw new MarketContractViolation('$.crossplay', '必须是 boolean');
  validateRank(request.rank, '$.rank');
}

function validateSuccess(value: Record<string, unknown>): void {
  exactKeys(value, ['contractVersion', 'ok', 'data', 'evidence', 'warnings'], '$');
  const data = record(value.data, '$.data');
  exactKeys(data, ['requestedItem', 'item', 'sellOrders', 'buyOrders', 'statistics'], '$.data');
  text(data.requestedItem, '$.data.requestedItem', 120);
  validateResolvedItem(data.item, '$.data.item');
  for (const [key, side] of [['sellOrders', 'sell'], ['buyOrders', 'buy']] as const) {
    const orders = data[key];
    if (!Array.isArray(orders)) throw new MarketContractViolation(`$.data.${key}`, '必须是数组');
    orders.forEach((order, index) => validateOrder(order, side, `$.data.${key}[${index}]`));
  }
  if (data.statistics !== undefined) {
    const stats = record(data.statistics, '$.data.statistics');
    exactKeys(stats, ['basis', 'median', 'dailyVolume', 'sampleSize', 'rank', 'asOf'], '$.data.statistics');
    if (stats.basis !== 'closed_trades_90_days') throw new MarketContractViolation('$.data.statistics.basis', '统计口径无效');
    number(stats.median, '$.data.statistics.median', { min: 0 });
    number(stats.dailyVolume, '$.data.statistics.dailyVolume', { min: 0 });
    number(stats.sampleSize, '$.data.statistics.sampleSize', { integer: true, min: 0 });
    number(stats.rank, '$.data.statistics.rank', { integer: true, min: 0 });
    iso(stats.asOf, '$.data.statistics.asOf');
  }
  validateEvidence(value.evidence, '$.evidence');
  if (!Array.isArray(value.warnings)) throw new MarketContractViolation('$.warnings', '必须是数组');
  value.warnings.forEach((entry, index) => {
    const warning = record(entry, `$.warnings[${index}]`);
    exactKeys(warning, ['code', 'message'], `$.warnings[${index}]`);
    enumValue(warning.code, [...WARNING_CODES], `$.warnings[${index}].code`);
    text(warning.message, `$.warnings[${index}].message`, 240);
  });
  const sellOrders = data.sellOrders as unknown[];
  const buyOrders = data.buyOrders as unknown[];
  const noOrders = sellOrders.length === 0 && buyOrders.length === 0;
  const finding = (value.evidence as Record<string, unknown>).finding;
  if (noOrders !== (finding === 'confirmed_absent_in_scope')) {
    throw new MarketContractViolation('$.evidence.finding', '订单为空时必须为 confirmed_absent_in_scope，存在订单时必须为 confirmed_present');
  }
}

function validateFailure(value: Record<string, unknown>): void {
  exactKeys(value, ['contractVersion', 'ok', 'error', 'evidence'], '$');
  const error = record(value.error, '$.error');
  exactKeys(error, ['category', 'code', 'message', 'retryable', 'details'], '$.error');
  enumValue(error.code, [...ERROR_CODES], '$.error.code');
  const code = error.code as MarketQueryErrorCode;
  if (error.category !== ERROR_CATEGORY_BY_CODE[code]) throw new MarketContractViolation('$.error.category', `必须是 ${ERROR_CATEGORY_BY_CODE[code]}`);
  text(error.message, '$.error.message', 240);
  if (error.retryable !== RETRYABLE_ERROR_CODES.has(code)) throw new MarketContractViolation('$.error.retryable', '与错误码的重试策略不一致');
  if (error.details !== undefined) {
    const details = record(error.details, '$.error.details');
    exactKeys(details, ['field', 'candidates', 'retryAfterMs'], '$.error.details');
    if (details.field !== undefined) enumValue(details.field, ['contractVersion', 'item', 'platform', 'crossplay', 'rank'], '$.error.details.field');
    if (details.retryAfterMs !== undefined) number(details.retryAfterMs, '$.error.details.retryAfterMs', { integer: true, min: 0 });
    if (details.candidates !== undefined) {
      if (!Array.isArray(details.candidates)) throw new MarketContractViolation('$.error.details.candidates', '必须是数组');
      details.candidates.forEach((candidate, index) => {
        const item = record(candidate, `$.error.details.candidates[${index}]`);
        exactKeys(item, ['slug', 'name'], `$.error.details.candidates[${index}]`);
        text(item.slug, `$.error.details.candidates[${index}].slug`, 120);
        validateName(item.name, `$.error.details.candidates[${index}].name`);
      });
    }
  }
  if (value.evidence !== undefined) {
    validateEvidence(value.evidence, '$.evidence');
    const finding = (value.evidence as Record<string, unknown>).finding;
    if (finding !== 'unavailable') throw new MarketContractViolation('$.evidence.finding', '失败结果只能携带 unavailable 证据');
  }
}

export function assertMarketQueryResult(value: unknown): asserts value is MarketQueryResult {
  const result = record(value, '$');
  if (result.contractVersion !== MARKET_QUERY_CONTRACT_VERSION) throw new MarketContractViolation('$.contractVersion', '版本不受支持');
  if (result.ok === true) validateSuccess(result);
  else if (result.ok === false) validateFailure(result);
  else throw new MarketContractViolation('$.ok', '必须是 boolean 判别字段');
}

export function isMarketQueryResult(value: unknown): value is MarketQueryResult {
  try {
    assertMarketQueryResult(value);
    return true;
  } catch {
    return false;
  }
}
