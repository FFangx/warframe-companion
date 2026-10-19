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

/**
 * Bounded https URL for Warframe.Market static assets. The renderer may only
 * load these known-safe URLs; anything else (data:, file:, arbitrary hosts,
 * query strings) is rejected by contract validation.
 */
export type MarketAssetUrl = `https://warframe.market/static/assets/${string}`;

export interface MarketOrder {
  side: MarketOrderSide;
  platinum: number;
  quantity: number;
  ingameName: string;
  status: MarketUserStatus;
  platform: MarketPlatform;
  crossplay: boolean | null;
  rank: number | null;
  /** Seller community reputation as reported by warframe.market; null when absent. */
  reputation: number | null;
  /** Seller account locale (e.g. `zh-hans`, `en`); null when unknown. Drives the `/w` language. */
  locale: string | null;
  updatedAt: string;
}

export interface MarketItemImage {
  thumb: MarketAssetUrl | null;
  icon: MarketAssetUrl | null;
  subIcon: MarketAssetUrl | null;
}

/**
 * Localized item description. MOD/arcane card effects are derived from the
 * zh-Hans description (falling back to English); other items may be null.
 */
export interface MarketItemDescription {
  en: string | null;
  zhHans: string | null;
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
  /** Safe display image; null when the item has no usable image (section-local degradation). */
  image: MarketItemImage | null;
  description: MarketItemDescription;
}

export interface ClosedTradeStatistics {
  basis: 'closed_trades_90_days';
  median: number;
  dailyVolume: number;
  sampleSize: number;
  rank: number;
  asOf: string;
  /**
   * Current lowest sell order vs the 90-day closed-trade median, in percent
   * (positive = current is higher than history). null when there is no sell
   * order or the median is zero. History and current stay separate fields:
   * this is a comparison, never a price of its own.
   */
  deviationPct: number | null;
}

export interface MarketSetComponent {
  slug: string;
  name: {
    en: string;
    zhHans: string;
  };
  /** Copies required to build the set (from item detail metadata). */
  quantity: number;
  /** Current lowest sell of this component; null = quote missing (no fabrication). */
  lowestSell: number | null;
}

export interface MarketSetComparison {
  root: true;
  components: MarketSetComponent[];
  /**
   * Sum of the available component quotes only. null when no component has a
   * quote; missing components never contribute a zero or a guess, and the
   * missing count is reported separately.
   */
  componentsTotal: number | null;
  pricedCount: number;
  missingCount: number;
  /** Current lowest sell of the whole set from the same snapshot. */
  setLowest: number | null;
}

export type MarketWarningCode =
  | 'NO_SELL_ORDERS'
  | 'NO_BUY_ORDERS'
  | 'STATISTICS_UNAVAILABLE'
  | 'SET_COMPONENTS_UNAVAILABLE'
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
    /** Present only for set-root items after component resolution; omitted when unavailable. */
    set?: MarketSetComparison;
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
  'NO_SELL_ORDERS', 'NO_BUY_ORDERS', 'STATISTICS_UNAVAILABLE', 'SET_COMPONENTS_UNAVAILABLE', 'STALE_DATA',
]);
const ERROR_CODES = new Set<MarketQueryErrorCode>(Object.keys(ERROR_CATEGORY_BY_CODE) as MarketQueryErrorCode[]);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
// Bounded market asset URL: https only, fixed host, no query/fragment/userinfo
// or path traversal. The renderer must never load an unvalidated URL.
const MARKET_ASSET_URL = /^https:\/\/warframe\.market\/static\/assets\/[A-Za-z0-9._/-]{1,200}$/u;
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;
const SET_COMPONENT_LIMIT = 24;
const ORDER_ARRAY_LIMIT = 50;
const WARNING_LIMIT = 12;
const TAG_LIMIT = 24;

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

function boundedAssetUrl(value: unknown, path: string): void {
  if (typeof value !== 'string' || value.length > 300 || !MARKET_ASSET_URL.test(value) || value.includes('..')) {
    throw new MarketContractViolation(path, '必须是 warframe.market 静态资源 https URL');
  }
}

function nullableAssetUrl(value: unknown, path: string): void {
  if (value !== null) boundedAssetUrl(value, path);
}

function nullableLocale(value: unknown, path: string): void {
  if (value === null) return;
  if (typeof value !== 'string' || value.length > 40 || !LOCALE.test(value)) {
    throw new MarketContractViolation(path, '必须是 BCP-47 风格语言标签或 null');
  }
}

function nullableBoundedNumber(value: unknown, path: string, min: number, max: number): void {
  if (value === null) return;
  number(value, path);
  if (value < min || value > max) throw new MarketContractViolation(path, `数值超出 ${min}–${max} 范围`);
}

function boundedArray<T>(value: unknown, path: string, limit: number, validate: (entry: unknown, index: number) => asserts entry is T): void {
  if (!Array.isArray(value) || value.length > limit) {
    throw new MarketContractViolation(path, `必须是至多 ${limit} 项的数组`);
  }
  value.forEach((entry, index) => validate(entry, index));
}

function validateName(value: unknown, path: string): void {
  const name = record(value, path);
  exactKeys(name, ['en', 'zhHans'], path);
  text(name.en, `${path}.en`, 120);
  text(name.zhHans, `${path}.zhHans`, 120);
}

function validateImage(value: unknown, path: string): void {
  if (value === null) return;
  const image = record(value, path);
  exactKeys(image, ['thumb', 'icon', 'subIcon'], path);
  nullableAssetUrl(image.thumb, `${path}.thumb`);
  nullableAssetUrl(image.icon, `${path}.icon`);
  nullableAssetUrl(image.subIcon, `${path}.subIcon`);
}

function validateDescription(value: unknown, path: string): void {
  const description = record(value, path);
  exactKeys(description, ['en', 'zhHans'], path);
  for (const [key, lang] of [['en', 'en'], ['zhHans', 'zhHans']] as const) {
    const entry = description[key];
    if (entry !== null && (typeof entry !== 'string' || entry.length > 2_000)) {
      throw new MarketContractViolation(`${path}.${lang}`, '必须是至多 2000 字符的字符串或 null');
    }
  }
}

function validateResolvedItem(value: unknown, path: string): void {
  const item = record(value, path);
  exactKeys(item, ['slug', 'name', 'tags', 'rank', 'ducats', 'tradingTax', 'masteryRank', 'image', 'description'], path);
  text(item.slug, `${path}.slug`, 120);
  validateName(item.name, `${path}.name`);
  if (!Array.isArray(item.tags) || item.tags.length > TAG_LIMIT) throw new MarketContractViolation(`${path}.tags`, `必须是至多 ${TAG_LIMIT} 项的数组`);
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
  validateImage(item.image, `${path}.image`);
  validateDescription(item.description, `${path}.description`);
}

function validateOrder(value: unknown, side: MarketOrderSide, path: string): void {
  const order = record(value, path);
  exactKeys(order, ['side', 'platinum', 'quantity', 'ingameName', 'status', 'platform', 'crossplay', 'rank', 'reputation', 'locale', 'updatedAt'], path);
  if (order.side !== side) throw new MarketContractViolation(`${path}.side`, `必须是 ${side}`);
  number(order.platinum, `${path}.platinum`, { min: 0 });
  number(order.quantity, `${path}.quantity`, { integer: true, min: 1 });
  text(order.ingameName, `${path}.ingameName`, 80);
  enumValue(order.status, ['ingame', 'online', 'offline', 'unknown'], `${path}.status`);
  enumValue(order.platform, MARKET_PLATFORMS, `${path}.platform`);
  if (order.crossplay !== null && typeof order.crossplay !== 'boolean') throw new MarketContractViolation(`${path}.crossplay`, '必须是 boolean 或 null');
  if (order.rank !== null) number(order.rank, `${path}.rank`, { integer: true, min: 0 });
  nullableBoundedNumber(order.reputation, `${path}.reputation`, -1_000_000, 1_000_000);
  nullableLocale(order.locale, `${path}.locale`);
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

function validateStatistics(value: unknown, path: string): void {
  const stats = record(value, path);
  exactKeys(stats, ['basis', 'median', 'dailyVolume', 'sampleSize', 'rank', 'asOf', 'deviationPct'], path);
  if (stats.basis !== 'closed_trades_90_days') throw new MarketContractViolation(`${path}.basis`, '统计口径无效');
  number(stats.median, `${path}.median`, { min: 0 });
  number(stats.dailyVolume, `${path}.dailyVolume`, { min: 0 });
  number(stats.sampleSize, `${path}.sampleSize`, { integer: true, min: 0 });
  number(stats.rank, `${path}.rank`, { integer: true, min: 0 });
  iso(stats.asOf, `${path}.asOf`);
  nullableBoundedNumber(stats.deviationPct, `${path}.deviationPct`, -1_000, 1_000);
}

function validateSetComparison(value: unknown, path: string): void {
  const set = record(value, path);
  exactKeys(set, ['root', 'components', 'componentsTotal', 'pricedCount', 'missingCount', 'setLowest'], path);
  if (set.root !== true) throw new MarketContractViolation(`${path}.root`, '必须是 true');
  boundedArray(set.components, `${path}.components`, SET_COMPONENT_LIMIT, (entry, index) => {
    const component = record(entry, `${path}.components[${index}]`);
    exactKeys(component, ['slug', 'name', 'quantity', 'lowestSell'], `${path}.components[${index}]`);
    text(component.slug, `${path}.components[${index}].slug`, 120);
    validateName(component.name, `${path}.components[${index}].name`);
    number(component.quantity, `${path}.components[${index}].quantity`, { integer: true, min: 1 });
    if (component.quantity > 99) throw new MarketContractViolation(`${path}.components[${index}].quantity`, '必须不大于 99');
    nullableNumber(component.lowestSell, `${path}.components[${index}].lowestSell`);
  });
  const components = set.components as unknown[];
  const pricedCount = set.pricedCount;
  const missingCount = set.missingCount;
  number(pricedCount, `${path}.pricedCount`, { integer: true, min: 0 });
  number(missingCount, `${path}.missingCount`, { integer: true, min: 0 });
  if (pricedCount + missingCount !== components.length) {
    throw new MarketContractViolation(`${path}`, 'pricedCount + missingCount 必须等于部件数量');
  }
  const quotedComponents = (set.components as Array<Record<string, unknown>>).filter((component) => component.lowestSell !== null);
  if (pricedCount !== quotedComponents.length || missingCount !== components.length - quotedComponents.length) {
    throw new MarketContractViolation(`${path}`, '报价计数必须与部件报价逐项一致');
  }
  if (set.componentsTotal !== null) number(set.componentsTotal, `${path}.componentsTotal`, { min: 0 });
  if ((pricedCount === 0) !== (set.componentsTotal === null)) {
    throw new MarketContractViolation(`${path}.componentsTotal`, '无任何报价时必须为 null，有报价时必须给出求和');
  }
  if (set.componentsTotal !== null) {
    const expectedTotal = Math.round(quotedComponents.reduce((sum, component) =>
      sum + Number(component.lowestSell) * Number(component.quantity), 0) * 10) / 10;
    if (set.componentsTotal !== expectedTotal) {
      throw new MarketContractViolation(`${path}.componentsTotal`, '必须等于已有部件报价按数量求和');
    }
  }
  nullableNumber(set.setLowest, `${path}.setLowest`);
}

function validateSuccess(value: Record<string, unknown>): void {
  exactKeys(value, ['contractVersion', 'ok', 'data', 'evidence', 'warnings'], '$');
  const data = record(value.data, '$.data');
  exactKeys(data, ['requestedItem', 'item', 'sellOrders', 'buyOrders', 'statistics', 'set'], '$.data');
  text(data.requestedItem, '$.data.requestedItem', 120);
  validateResolvedItem(data.item, '$.data.item');
  for (const [key, side] of [['sellOrders', 'sell'], ['buyOrders', 'buy']] as const) {
    boundedArray(data[key], `$.data.${key}`, ORDER_ARRAY_LIMIT, (order, index) => validateOrder(order, side, `$.data.${key}[${index}]`));
  }
  if (data.statistics !== undefined) validateStatistics(data.statistics, '$.data.statistics');
  if (data.set !== undefined) {
    validateSetComparison(data.set, '$.data.set');
    const set = data.set as Record<string, unknown>;
    const sellOrders = data.sellOrders as Array<Record<string, unknown>>;
    const expectedSetLowest = sellOrders.length ? sellOrders[0]?.platinum ?? null : null;
    if (set.setLowest !== expectedSetLowest) {
      throw new MarketContractViolation('$.data.set.setLowest', '必须匹配当前快照最低卖价');
    }
  }
  validateEvidence(value.evidence, '$.evidence');
  boundedArray(value.warnings, '$.warnings', WARNING_LIMIT, (entry, index) => {
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
